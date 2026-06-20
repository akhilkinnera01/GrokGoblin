import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
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

  if (options.madmax || options.yolo) {
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
  // so every `gg -w` launch gets its own clean, named workspace.
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
    print("Then run: gg setup");
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
  const instructionsPath = writeSessionInstructions(grokHome, sessionId, overlay);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GG_SESSION_ID: sessionId,
    GG_STARTUP_CWD: launchCwd,
    GG_ENTRY_PATH: process.argv[1] ?? "gg",
    GROK_HOME: grokHome,
  };

  const grokArgs = [
    ...buildGrokArgs(options),
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
  } else {
    const result = spawnSync(grokBin, grokArgs, {
      stdio: "inherit",
      env,
      cwd: launchCwd,
    });

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
    madmax?: boolean;
    tools?: string;
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

  if (options.madmax) {
    args.push("--always-approve");
  }

  // Restrict the toolset (headless only) — used by `gg explore` for read-only runs.
  if (options.tools) {
    args.push("--tools", options.tools);
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
