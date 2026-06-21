import { existsSync, mkdirSync, writeFileSync, readFileSync, openSync, closeSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import type { LaunchOptions, ResolvedLaunchPolicy } from "../types/index.js";
import {
  resolveGrokHome,
  resolveGgStateDir,
  resolveAgentsMdPath,
  ggSessionId,
  resolveGgSessionInstructionsPath,
  DEFAULT_FRONTIER_MODEL,
  DEFAULT_FAST_MODEL,
  modelSupportsEffort,
} from "../utils/paths.js";
import {
  generateRuntimeOverlay,
  injectOverlayIntoAgentsMd,
  stripOverlayFromAgentsMd,
  overlayRegionIncludes,
  writeSessionInstructions,
  cleanupSessionInstructions,
} from "../hooks/agents-overlay.js";
import { createSessionState } from "../hooks/session.js";
import { buildHookEvent, dispatchHookEvent } from "../hooks/extensibility/dispatcher.js";
import {
  commandExists,
  isInsideTmux,
  tmuxAvailable,
  tmuxNewSession,
  tmuxHasSession,
  tmuxAttach,
  isGitRepo,
  gitRepoRoot,
} from "../utils/exec.js";
import {
  createWorktree,
  generateWorktreeName,
  slugifyWorktreeName,
} from "../utils/worktree.js";
import { leaderSocketArgs } from "../utils/leader.js";
import { printIsolationBanner } from "./worktree.js";
import { step, warn, info, print, dim, bold } from "../utils/print.js";
import { ensureDir, readFileOrEmpty } from "../utils/toml.js";

function resolvePolicy(
  options: LaunchOptions,
  env = process.env
): ResolvedLaunchPolicy {
  const envPolicy = env["GG_LAUNCH_POLICY"];

  if (
    options.direct ||
    envPolicy === "direct" ||
    process.platform === "win32" ||
    !process.stdout.isTTY
  ) {
    return { policy: "direct", reason: "explicit/platform/no-tty" };
  }

  if (isInsideTmux(env)) {
    return { policy: "inside-tmux", reason: "already in tmux" };
  }

  if (options.tmux || envPolicy === "tmux" || envPolicy === "detached-tmux") {
    if (tmuxAvailable()) {
      return { policy: "detached-tmux", reason: "tmux flag or env policy" };
    }
    warn("tmux requested but not available — launching direct");
    return { policy: "direct", reason: "tmux unavailable" };
  }

  if (envPolicy === "auto" || !envPolicy) {
    if (tmuxAvailable()) {
      return { policy: "detached-tmux", reason: "auto: tmux available" };
    }
    return { policy: "direct", reason: "auto: no tmux" };
  }

  return { policy: "direct", reason: "fallback" };
}

function buildGrokArgs(options: LaunchOptions): string[] {
  const args: string[] = [];

  // Expose grok's cross-session memory tools (memory_search/get) in-session.
  args.push("--experimental-memory");

  // grok's permission/effort flags are honored in headless mode (`-p`); in the
  // interactive TUI grok prints a warning and ignores them (see grok README).
  if (options.mode === "plan") {
    args.push("--permission-mode", "plan");
  } else if (options.mode === "ask") {
    args.push("--permission-mode", "default");
  }

  const effectiveModel = options.model ?? (options.fast ? DEFAULT_FAST_MODEL : undefined);

  if (options.high || options.xhigh) {
    const level = options.xhigh ? "xhigh" : "high";
    // grok ignores --effort in the interactive TUI AND no current model supports
    // reasoning effort, so emitting it is a no-op at best / a 400 at worst.
    if (modelSupportsEffort(effectiveModel)) {
      args.push("--effort", level);
    } else {
      warn(
        "reasoning effort is not supported by current grok models (and is ignored in interactive mode) — skipping"
      );
    }
  }

  if (effectiveModel) {
    args.push("-m", effectiveModel);
  }

  if (options.berserk || options.yolo) {
    args.push("--always-approve");
  }

  // grok has no `--parallel` flag; sub-agent parallelism is automatic. Honoring
  // the GrokGoblin flag here would make grok reject the launch, so it is intentionally
  // not forwarded.

  return args;
}

async function prepareWorktree(
  cwd: string,
  worktree: string | boolean
): Promise<string> {
  if (!isGitRepo(cwd)) {
    warn("--worktree requires a git repository. Launching in current directory.");
    return cwd;
  }

  const repoRoot = gitRepoRoot(cwd) ?? cwd;
  // Smart default: a memorable goblin name instead of a fixed "detached" branch,
  // so every `goblin -w` launch gets its own clean, named workspace.
  const name =
    typeof worktree === "string" && worktree.trim()
      ? slugifyWorktreeName(worktree)
      : generateWorktreeName();

  const res = createWorktree(repoRoot, name);
  if (res.created) {
    step(`Created isolated worktree "${res.name}"`);
  } else {
    info(`Reusing worktree "${res.name}"`);
  }
  printIsolationBanner(res);
  return res.path;
}

// Best-effort exclusive file lock (atomic O_EXCL create) so concurrent `goblin`
// sessions don't interleave the read-modify-write of the shared AGENTS.md.
function withAgentsLock(lockPath: string, fn: () => void): void {
  let fd: number | undefined;
  const deadline = Date.now() + 2000;
  while (fd === undefined) {
    try {
      fd = openSync(lockPath, "wx");
    } catch {
      if (Date.now() > deadline) {
        // Assume a stale lock; proceed without it rather than hang.
        try { unlinkSync(lockPath); } catch {}
        break;
      }
      const until = Date.now() + 25;
      while (Date.now() < until) { /* brief spin */ }
    }
  }
  try {
    fn();
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
      try { unlinkSync(lockPath); } catch {}
    }
  }
}

// Inject the runtime overlay into the global AGENTS.md (between the RUNTIME
// markers) so grok reliably reads it as part of its system prompt. Returns a
// restore function that strips the overlay on exit. Concurrency-safe: the
// read-modify-write is locked, and on exit we ONLY strip if the overlay region
// is still ours (matches our sessionId) — so we never wipe another concurrent
// session's overlay or leave stale snapshot content behind.
function injectOverlayIntoAgentsMdFile(
  grokHome: string,
  overlay: string,
  sessionId: string
): () => void {
  const agentsMdPath = resolveAgentsMdPath(grokHome);
  if (!existsSync(agentsMdPath)) {
    // No AGENTS.md yet (setup not run) — nothing to inject into.
    return () => {};
  }
  const lockPath = agentsMdPath + ".lock";
  try {
    withAgentsLock(lockPath, () => {
      const original = readFileSync(agentsMdPath, "utf-8");
      writeFileSync(agentsMdPath, injectOverlayIntoAgentsMd(original, overlay), "utf-8");
    });
  } catch {
    return () => {};
  }
  return () => {
    try {
      withAgentsLock(lockPath, () => {
        const current = readFileSync(agentsMdPath, "utf-8");
        if (overlayRegionIncludes(current, sessionId)) {
          writeFileSync(agentsMdPath, stripOverlayFromAgentsMd(current), "utf-8");
        }
      });
    } catch {
      // best-effort cleanup; a leftover overlay is harmless and overwritten next launch.
    }
  };
}

export async function runLaunch(
  cwd: string,
  options: LaunchOptions,
  extraArgs: string[] = []
): Promise<void> {
  const grokHome = resolveGrokHome();
  const sessionId = ggSessionId();
  const grokBin = process.env["GROK_BIN"] ?? "grok";

  if (!commandExists(grokBin)) {
    warn(`grok not found. Install it first:`);
    print("  curl -fsSL https://x.ai/cli/install.sh | sh");
    print("Then run: goblin setup");
    process.exit(1);
  }

  let launchCwd = cwd;

  if (options.worktree) {
    launchCwd = await prepareWorktree(cwd, options.worktree);
  }

  ensureDir(join(launchCwd, ".grokgoblin", "state"));
  ensureDir(join(launchCwd, ".grokgoblin", "logs"));

  const session = createSessionState(launchCwd, sessionId);

  const overlay = generateRuntimeOverlay(launchCwd, sessionId);
  // Keep the session-instructions file for tooling/inspection, but DON'T rely on
  // an async SessionStart hook to inject the dynamic overlay — grok runs those
  // hooks async and ignores their output. Instead inject the overlay directly
  // into AGENTS.md (always loaded into grok's system prompt) and strip it on exit.
  writeSessionInstructions(grokHome, sessionId, overlay);
  const restoreAgentsMd = injectOverlayIntoAgentsMdFile(grokHome, overlay, sessionId);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GG_SESSION_ID: sessionId,
    GG_STARTUP_CWD: launchCwd,
    GG_ENTRY_PATH: process.argv[1] ?? "gg",
    GROK_HOME: grokHome,
  };

  const grokArgs = [
    ...buildGrokArgs(options),
    ...leaderSocketArgs(grokHome, launchCwd, env),
    ...extraArgs,
    "--cwd", launchCwd,
  ];

  const policy = resolvePolicy(options, env);

  dispatchHookEvent(
    buildHookEvent("session-start", sessionId, launchCwd, {
      policy: policy.policy,
      grokArgs,
    }),
    launchCwd,
    grokHome
  );

  if (policy.policy === "detached-tmux") {
    const tmuxSessionName = `gg-${sessionId.slice(-8)}`;

    if (!tmuxHasSession(tmuxSessionName)) {
      tmuxNewSession(
        tmuxSessionName,
        grokBin,
        grokArgs,
        launchCwd
      );
    }

    print(dim(`Launched in tmux session: ${bold(tmuxSessionName)}`));
    print(dim(`Attaching... (Ctrl+B D to detach)`));
    tmuxAttach(tmuxSessionName);
    // grok loaded AGENTS.md when its session started; safe to restore now.
    restoreAgentsMd();
  } else {
    const result = spawnSync(grokBin, grokArgs, {
      stdio: "inherit",
      env,
      cwd: launchCwd,
    });

    restoreAgentsMd();
    cleanupSessionInstructions(grokHome, sessionId);

    dispatchHookEvent(
      buildHookEvent("session-end", sessionId, launchCwd, {
        exitCode: result.status,
      }),
      launchCwd,
      grokHome
    );

    process.exit(result.status ?? 0);
  }
}

export async function runExec(
  cwd: string,
  prompt: string,
  options: {
    check?: boolean;
    model?: string;
    outputFormat?: string;
    skipGitRepoCheck?: boolean;
    effort?: string;
    berserk?: boolean;
    tools?: string;
    bestOf?: number;
  } = {}
): Promise<void> {
  const grokBin = process.env["GROK_BIN"] ?? "grok";
  const grokHome = resolveGrokHome();

  if (!commandExists(grokBin)) {
    print("error: grok not found");
    process.exit(1);
  }

  if (!options.skipGitRepoCheck && !isGitRepo(cwd)) {
    warn("Not in a git repository. Pass --skip-git-repo-check to override.");
    process.exit(1);
  }

  const args = ["-p", prompt, "--output-format", options.outputFormat ?? "streaming-json"];

  // Isolate the leader by MCP-config fingerprint so headless runs pick up MCP
  // config edits instead of attaching to a stale leader's cached servers.
  args.push(...leaderSocketArgs(grokHome, cwd, process.env));

  if (options.model) {
    args.push("-m", options.model);
  }

  // grok honors --effort / --always-approve in headless mode (`-p`).
  const VALID_EFFORT = ["low", "medium", "high", "xhigh", "max"];
  if (options.effort) {
    if (!VALID_EFFORT.includes(options.effort)) {
      warn(`invalid --effort '${options.effort}' (valid: ${VALID_EFFORT.join(", ")})`);
      process.exit(1);
    }
    // Skip the flag if the target model can't do reasoning effort (would 400).
    if (modelSupportsEffort(options.model)) {
      args.push("--effort", options.effort);
    } else {
      warn(
        `reasoning effort is not supported by ${options.model ?? "the current grok model"} — ignoring --effort`
      );
    }
  }

  if (options.berserk) {
    args.push("--always-approve");
  }

  // Restrict the toolset (headless only) — used by `goblin explore` for read-only runs.
  if (options.tools) {
    args.push("--tools", options.tools);
  }

  // --best-of-n: run the task N ways in parallel and keep the best (headless only).
  if (options.bestOf && options.bestOf > 1) {
    args.push("--best-of-n", String(options.bestOf));
  }

  const result = spawnSync(grokBin, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      GROK_HOME: grokHome,
    },
    cwd,
  });

  process.exit(result.status ?? 0);
}
