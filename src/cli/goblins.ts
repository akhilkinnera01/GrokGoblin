import { join } from "path";
import { existsSync } from "fs";
import {
  resolveGrokHome,
  resolveGgStateDir,
  DEFAULT_FAST_MODEL,
  DEFAULT_MODEL,
} from "../utils/paths.js";
import { AGENT_DEFINITIONS } from "../agents/definitions.js";
import { buildRolePrompt } from "../config/subagents.js";
import {
  print,
  ok,
  warn,
  info,
  header,
  dim,
  bold,
  step,
} from "../utils/print.js";
import {
  commandExists,
  tmuxAvailable,
  tmuxNewSession,
  tmuxListSessions,
  tmuxHasSession,
  tmuxKillSession,
  isGitRepo,
  gitRepoRoot,
  spawnGrokHeadless,
} from "../utils/exec.js";
import { ensureDir, writeJsonFile, readJsonFile } from "../utils/toml.js";
import { ggSessionId } from "../utils/paths.js";
import { leaderSocketArgs } from "../utils/leader.js";
import { runGoblinsVerified } from "./cruise.js";
import { runGoblinsParallel } from "./parallel.js";
import { spawnSync } from "child_process";

// Parse the optional `N[:role]` prefix from a goblins task string.
function parseGoblinsTask(taskStr: string): {
  workerCount: number;
  preferredRole: string;
  task: string;
} {
  const m = taskStr.match(/^(\d+)(?::([\w-]+))?\s+(.+)$/);
  if (m) {
    return {
      workerCount: Math.min(8, Math.max(1, parseInt(m[1]!))),
      preferredRole: m[2] ?? "",
      task: m[3]!,
    };
  }
  return { workerCount: 3, preferredRole: "", task: taskStr };
}

interface SwarmWorkerConfig {
  id: number;
  name: string;
  task: string;
  worktreePath?: string;
  tmuxPaneId?: string;
  status: "pending" | "running" | "done" | "failed";
  startedAt?: string;
}

interface SwarmState {
  swarmName: string;
  leaderSessionId: string;
  task: string;
  workerCount: number;
  workers: SwarmWorkerConfig[];
  startedAt: string;
  status: "running" | "complete" | "failed";
}

function resolveSwarmStatePath(cwd: string, swarmName: string): string {
  return join(resolveGgStateDir(cwd), "state", "goblins", swarmName, "state.json");
}

export async function runGoblins(
  cwd: string,
  args: string[],
  flags: Record<string, string | boolean | number>
): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case "status":
      await runGoblinsStatus(cwd, args[1]);
      break;
    case "shutdown":
      await runGoblinsShutdown(cwd, args[1], flags);
      break;
    case "resume":
      await runGoblinsResume(cwd, args[1]);
      break;
    default:
      // Default: a VERIFIED multi-goblin loop — fan work out to specialist
      // goblins, then run the same deterministic/QC gate as cruise until correct.
      // `--once` keeps the legacy single-shot orchestration; `--tmux` the legacy
      // multi-pane interactive mode.
      if (flags["tmux"]) {
        await runGoblinsTmux(cwd, args, flags);
      } else if (flags["once"]) {
        await runGoblinsOnce(cwd, args, flags);
      } else if (flags["parallel"]) {
        await runGoblinsParallelLoop(cwd, args, flags);
      } else {
        await runGoblinsLoop(cwd, args, flags);
      }
      break;
  }
}

// Default Goblins mode: a VERIFIED loop. Fans work out to specialist goblins and
// loops through the same deterministic/QC gate as cruise until the work is correct.
async function runGoblinsLoop(
  cwd: string,
  args: string[],
  flags: Record<string, string | boolean | number>
): Promise<void> {
  const { workerCount, preferredRole, task } = parseGoblinsTask(args.join(" ").trim());
  if (!task) {
    warn("goblin swarm requires a task description");
    print('  Example: goblin swarm 3 "refactor the auth module and add tests"');
    print('  Single-shot (legacy): goblin swarm --once 3 "..."');
    print('  Tmux panes (legacy):   goblin swarm --tmux 3:executor "..."');
    process.exit(1);
  }
  const maxRaw = flags["max-iterations"] as string | undefined;
  await runGoblinsVerified(cwd, task, workerCount, preferredRole, {
    maxIterations: maxRaw ? Number(maxRaw) : undefined,
    model: flags["model"] as string | undefined,
    fast: Boolean(flags["fast"]),
    skipGitRepoCheck: Boolean(flags["skip-git-repo-check"]),
    bestOf: flags["best-of"] ? Number(flags["best-of"]) : undefined,
    digest: !flags["no-digest"],
    verify: flags["verify"] as string | undefined,
    noVerify: Boolean(flags["no-verify"]),
    maxTurns: flags["max-turns"] ? Number(flags["max-turns"]) : undefined,
  });
}

// Parallel mode: split into independent units, run them as parallel grok
// processes in isolated worktrees, integrate, then verify (`goblin swarm --parallel`).
async function runGoblinsParallelLoop(
  cwd: string,
  args: string[],
  flags: Record<string, string | boolean | number>
): Promise<void> {
  const { workerCount, task } = parseGoblinsTask(args.join(" ").trim());
  if (!task) {
    warn("goblin swarm --parallel requires a task description");
    print('  Example: goblin swarm --parallel 4 "add a unit test file for each module"');
    process.exit(1);
  }
  const maxRaw = flags["max-iterations"] as string | undefined;
  await runGoblinsParallel(cwd, task, workerCount, {
    maxIterations: maxRaw ? Number(maxRaw) : undefined,
    model: flags["model"] as string | undefined,
    fast: Boolean(flags["fast"]),
    skipGitRepoCheck: Boolean(flags["skip-git-repo-check"]),
    bestOf: flags["best-of"] ? Number(flags["best-of"]) : undefined,
    digest: !flags["no-digest"],
    verify: flags["verify"] as string | undefined,
    noVerify: Boolean(flags["no-verify"]),
    maxTurns: flags["max-turns"] ? Number(flags["max-turns"]) : undefined,
  });
}

// Legacy single-shot: one grok "leader" session that fans the task out via the
// goblin roster, no verification loop (`goblin swarm --once`).
async function runGoblinsOnce(
  cwd: string,
  args: string[],
  flags: Record<string, string | boolean | number>
): Promise<void> {
  const grokBin = process.env["GROK_BIN"] ?? "grok";
  if (!commandExists(grokBin)) {
    warn("grok CLI not found. Run `goblin setup` first.");
    process.exit(1);
  }

  const taskStr = args.join(" ").trim();
  const workerMatch = taskStr.match(/^(\d+)(?::([\w-]+))?\s+(.+)$/);
  let workerCount = 3;
  let preferredRole = "";
  let task = taskStr;
  if (workerMatch) {
    workerCount = Math.min(8, Math.max(1, parseInt(workerMatch[1]!)));
    preferredRole = workerMatch[2] ?? "";
    task = workerMatch[3]!;
  }
  if (!task) {
    warn("goblin swarm requires a task description");
    print('  Example: goblin swarm 3 "refactor the auth module and add tests"');
    print('  Legacy tmux panes: goblin swarm --tmux 3:executor "..."');
    process.exit(1);
  }

  const roleNames = Object.keys(AGENT_DEFINITIONS);
  const grokHome = resolveGrokHome();
  const leaderModel = (flags["model"] as string) ?? DEFAULT_MODEL;

  header("GrokGoblin Goblins (native subagents)");
  print(`${dim("task:")}    ${task}`);
  print(`${dim("workers:")} up to ${workerCount} parallel subagents`);
  print(`${dim("roles:")}   ${roleNames.join(", ")}`);
  print(`${dim("leader:")}  ${leaderModel}`);
  print("");

  const prompt = [
    "You are the LEAD GOBLIN orchestrating a multi-goblin effort.",
    "",
    `## Task\n${task}`,
    "",
    "## How to work",
    `- Decompose the task into UP TO ${workerCount} independent specialist passes, each playing one of the GrokGoblin goblin roles below.`,
    `- Available goblin roles (registered via --agents): ${roleNames.join(", ")}.`,
    preferredRole ? `- Bias toward the \`${preferredRole}\` role for the specialist passes.` : "",
    "- PREFER spawning them as real parallel subagents via the `spawn_subagent` tool (alias `task`) if it is invocable in this session.",
    "- If subagent spawning is not invocable here, run the specialist passes yourself IN PARALLEL (e.g. parallel tool calls / background commands) — do NOT get stuck trying to call an unavailable tool.",
    "- Either way, each pass must have a clear, self-contained scope and run independently from the others.",
    "- Then integrate the passes, resolve conflicts, and verify (build/tests) if applicable.",
    "- Finish with a concise summary of what each goblin found and the final outcome.",
  ]
    .filter(Boolean)
    .join("\n");

  // Headless `grok -p` does NOT expose the subagent spawn tool unless agent
  // definitions are passed via --agents. Supplying the goblin roster here is what
  // makes `spawn_subagent` available so the leader spawns REAL native subagents
  // (verified: without --agents the leader falls back to background workers).
  const agentsMap: Record<string, { description: string; prompt: string; model: string }> = {};
  for (const [name, def] of Object.entries(AGENT_DEFINITIONS)) {
    agentsMap[name] = {
      description: def.description,
      prompt: buildRolePrompt(name, def),
      model: def.model,
    };
  }

  const grokArgs = [
    "--always-approve",
    "--experimental-memory",
    "--agents", JSON.stringify(agentsMap),
    "--output-format", "plain",
    "-m", leaderModel,
    // Isolate the leader by MCP-config fingerprint so the swarm run honors the
    // current MCP servers instead of a stale leader's cached connections.
    ...leaderSocketArgs(grokHome, cwd),
  ];

  const result = spawnGrokHeadless(
    prompt,
    grokArgs,
    { ...process.env, GROK_HOME: grokHome },
    grokBin
  );

  const output = (result.stdout || result.stderr || "").trim();
  if (output) print(output);
  print("");
  if (result.ok) {
    ok("Goblins run complete.");
  } else {
    warn(`Goblins run exited with status ${result.status}.`);
  }
}

async function runGoblinsTmux(
  cwd: string,
  args: string[],
  flags: Record<string, string | boolean | number>
): Promise<void> {
  if (!tmuxAvailable()) {
    warn("Goblins tmux mode requires tmux. Install it first:");
    print("  brew install tmux (macOS)");
    print("  sudo apt install tmux (Ubuntu/Debian)");
    process.exit(1);
  }

  if (!commandExists("grok")) {
    warn("grok CLI not found. Run `goblin setup` first.");
    process.exit(1);
  }

  const taskStr = args.join(" ");
  const workerMatch = taskStr.match(/^(\d+)(?::(\w+))?\s+(.+)$/);

  let workerCount = 2;
  let workerRole = "executor";
  let task = taskStr;

  if (workerMatch) {
    workerCount = parseInt(workerMatch[1]);
    workerRole = workerMatch[2] ?? "executor";
    task = workerMatch[3];
  }

  if (workerCount < 1 || workerCount > 8) {
    warn(`Worker count must be 1-8. Got ${workerCount}.`);
    workerCount = Math.min(8, Math.max(1, workerCount));
  }

  if (!task) {
    warn("goblin swarm requires a task description");
    print('  Example: goblin swarm 3:executor "fix the failing tests"');
    process.exit(1);
  }

  const sessionId = ggSessionId();
  const swarmName = `gg-goblins-${sessionId.slice(-6)}`;
  const grokHome = resolveGrokHome();
  const grokBin = process.env["GROK_BIN"] ?? "grok";
  const fastModel = (flags["spark"] as string) ?? DEFAULT_FAST_MODEL;
  const useWorktrees = Boolean(flags["worktrees"] ?? isGitRepo(cwd));

  header(`GrokGoblin Goblins: ${workerCount} workers`);
  print(dim(`Task: ${task}`));
  print(dim(`Session: ${swarmName}`));
  print("");

  const swarmStateDir = join(
    resolveGgStateDir(cwd),
    "state",
    "goblins",
    swarmName
  );
  ensureDir(swarmStateDir);

  const workers: SwarmWorkerConfig[] = [];

  for (let i = 0; i < workerCount; i++) {
    const workerName = `${swarmName}-w${i + 1}`;
    const workerTask = `${task} [worker ${i + 1}/${workerCount}: ${workerRole}]`;

    workers.push({
      id: i + 1,
      name: workerName,
      task: workerTask,
      status: "pending",
    });
  }

  const swarmState: SwarmState = {
    swarmName,
    leaderSessionId: sessionId,
    task,
    workerCount,
    workers,
    startedAt: new Date().toISOString(),
    status: "running",
  };

  writeJsonFile(join(swarmStateDir, "state.json"), swarmState);

  const leaderTmuxSession = `${swarmName}-leader`;
  // Same leader isolation as every other grok-spawning path, so unattended
  // workers honor the current MCP config (see utils/leader.ts).
  const leaderArgs = leaderSocketArgs(grokHome, cwd);

  step(`Starting ${workerCount} worker sessions...`);

  for (let i = 0; i < workerCount; i++) {
    const workerSessionName = `${swarmName}-w${i + 1}`;
    const workerArgs = [
      "-p",
      `You are a grunt worker goblin. Complete this task end-to-end, then verify your work: ${workers[i].task}`,
      "-m",
      fastModel,
      "--output-format",
      "streaming-json",
      // Workers run unattended in their own tmux pane — auto-approve so they
      // never stall waiting for an approval prompt no one is watching.
      "--always-approve",
      ...leaderArgs,
    ];
    tmuxNewSession(workerSessionName, grokBin, workerArgs, cwd);
    ok(`  Worker ${i + 1}: ${workerSessionName}`);
    workers[i].status = "running";
    workers[i].startedAt = new Date().toISOString();
  }

  writeJsonFile(join(swarmStateDir, "state.json"), { ...swarmState, workers });

  print("");
  ok(`Goblins ${swarmName} running with ${workerCount} workers.`);
  print("");
  print(dim("Monitor with: goblin swarm status " + swarmName));
  print(dim("Shutdown with: goblin swarm shutdown " + swarmName));
  print(dim("Attach to worker: tmux attach -t " + swarmName + "-w1"));
}

async function runGoblinsStatus(
  cwd: string,
  swarmName?: string
): Promise<void> {
  header("Goblins Status");

  if (!swarmName) {
    const sessions = tmuxListSessions().filter((s) =>
      s.startsWith("gg-goblins-")
    );
    if (sessions.length === 0) {
      print(dim("No active goblins sessions."));
      return;
    }
    for (const s of sessions) {
      print(`  ${s}`);
    }
    return;
  }

  const stateDir = join(
    resolveGgStateDir(cwd),
    "state",
    "goblins",
    swarmName
  );
  const state = readJsonFile<SwarmState>(join(stateDir, "state.json"));

  if (!state) {
    warn(`No state found for goblins: ${swarmName}`);
    return;
  }

  print(dim(`Goblins: ${state.swarmName}`));
  print(dim(`Task: ${state.task}`));
  print(dim(`Status: ${state.status}`));
  print(dim(`Workers: ${state.workerCount}`));
  print("");

  for (const worker of state.workers) {
    const isAlive = tmuxHasSession(worker.name);
    print(
      `  Worker ${worker.id}: ${bold(isAlive ? "running" : "stopped")}`
    );
    if (!isAlive && worker.status === "running") {
      worker.status = "done";
    }
  }
}

async function runGoblinsShutdown(
  cwd: string,
  swarmName?: string,
  flags: Record<string, string | boolean | number> = {}
): Promise<void> {
  if (!swarmName) {
    warn("Specify a goblins session name: goblin swarm shutdown <swarm-name>");
    process.exit(1);
  }

  header(`Shutting down goblins: ${swarmName}`);

  const sessions = tmuxListSessions().filter((s) =>
    s.startsWith(swarmName)
  );

  for (const session of sessions) {
    step(`Killing tmux session: ${session}`);
    tmuxKillSession(session);
    ok(`  ${session} stopped`);
  }

  ok(`Goblins ${swarmName} shut down.`);
}

async function runGoblinsResume(cwd: string, swarmName?: string): Promise<void> {
  if (!swarmName) {
    warn("Specify a goblins session name: goblin swarm resume <swarm-name>");
    process.exit(1);
  }

  const sessions = tmuxListSessions().filter((s) =>
    s.startsWith(swarmName)
  );

  if (sessions.length === 0) {
    warn(`No running sessions found for goblins: ${swarmName}`);
    return;
  }

  print(dim(`Resuming goblins: ${swarmName}`));
  print(dim(`Active sessions: ${sessions.join(", ")}`));

  const { tmuxAttach } = await import("../utils/exec.js");
  tmuxAttach(`${swarmName}-w1`);
}
