import { join } from "path";
import { existsSync } from "fs";
import {
  resolveGrokHome,
  resolveGgStateDir,
  DEFAULT_FAST_MODEL,
  DEFAULT_FRONTIER_MODEL,
} from "../utils/paths.js";
import { AGENT_DEFINITIONS } from "../agents/definitions.js";
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
import { spawnSync } from "child_process";

interface TeamWorkerConfig {
  id: number;
  name: string;
  task: string;
  worktreePath?: string;
  tmuxPaneId?: string;
  status: "pending" | "running" | "done" | "failed";
  startedAt?: string;
}

interface TeamState {
  teamName: string;
  leaderSessionId: string;
  task: string;
  workerCount: number;
  workers: TeamWorkerConfig[];
  startedAt: string;
  status: "running" | "complete" | "failed";
}

function resolveTeamStatePath(cwd: string, teamName: string): string {
  return join(resolveGgStateDir(cwd), "state", "team", teamName, "state.json");
}

export async function runTeam(
  cwd: string,
  args: string[],
  flags: Record<string, string | boolean | number>
): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case "status":
      await runTeamStatus(cwd, args[1]);
      break;
    case "shutdown":
      await runTeamShutdown(cwd, args[1], flags);
      break;
    case "resume":
      await runTeamResume(cwd, args[1]);
      break;
    default:
      // Default: orchestrate real grok subagents in one session (no tmux).
      // `--tmux` keeps the legacy multi-pane interactive mode.
      if (flags["tmux"]) {
        await runTeamLaunch(cwd, args, flags);
      } else {
        await runTeamNative(cwd, args, flags);
      }
      break;
  }
}

// Native team: a single grok "leader" session that fans the task out to parallel
// role-subagents via grok's Task tool, using the roles GrokGoblin installs.
async function runTeamNative(
  cwd: string,
  args: string[],
  flags: Record<string, string | boolean | number>
): Promise<void> {
  const grokBin = process.env["GROK_BIN"] ?? "grok";
  if (!commandExists(grokBin)) {
    warn("grok CLI not found. Run `gg setup` first.");
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
    warn("gg team requires a task description");
    print('  Example: gg team 3 "refactor the auth module and add tests"');
    print('  Legacy tmux panes: gg team --tmux 3:executor "..."');
    process.exit(1);
  }

  const roleNames = Object.keys(AGENT_DEFINITIONS);
  const grokHome = resolveGrokHome();
  const leaderModel = (flags["model"] as string) ?? DEFAULT_FRONTIER_MODEL;

  header("GrokGoblin Goblins (native subagents)");
  print(`${dim("task:")}    ${task}`);
  print(`${dim("workers:")} up to ${workerCount} parallel subagents`);
  print(`${dim("roles:")}   ${roleNames.join(", ")}`);
  print(`${dim("leader:")}  ${leaderModel}`);
  print("");

  const prompt = [
    "You are the TEAM LEADER orchestrating a multi-agent effort.",
    "",
    `## Task\n${task}`,
    "",
    "## How to work",
    `- Decompose the task into independent pieces and use the \`task\` tool to spawn UP TO ${workerCount} parallel subagents.`,
    `- Prefer these GrokGoblin specialist roles where they fit: ${roleNames.join(", ")}.`,
    preferredRole ? `- Bias toward the \`${preferredRole}\` role for the worker subagents.` : "",
    "- Assign each subagent a clear, self-contained scope. Run independent work in parallel.",
    "- After subagents return, integrate their results, resolve conflicts, and verify (build/tests) if applicable.",
    "- Finish with a concise summary of what each subagent did and the final outcome.",
  ]
    .filter(Boolean)
    .join("\n");

  const grokArgs = ["--always-approve", "--experimental-memory", "--output-format", "plain", "-m", leaderModel];

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
    ok("Team run complete.");
  } else {
    warn(`Team run exited with status ${result.status}.`);
  }
}

async function runTeamLaunch(
  cwd: string,
  args: string[],
  flags: Record<string, string | boolean | number>
): Promise<void> {
  if (!tmuxAvailable()) {
    warn("Team mode requires tmux. Install it first:");
    print("  brew install tmux (macOS)");
    print("  sudo apt install tmux (Ubuntu/Debian)");
    process.exit(1);
  }

  if (!commandExists("grok")) {
    warn("grok CLI not found. Run `gg setup` first.");
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
    warn("gg team requires a task description");
    print('  Example: gg team 3:executor "fix the failing tests"');
    process.exit(1);
  }

  const sessionId = ggSessionId();
  const teamName = `gg-team-${sessionId.slice(-6)}`;
  const grokHome = resolveGrokHome();
  const grokBin = process.env["GROK_BIN"] ?? "grok";
  const fastModel = (flags["spark"] as string) ?? DEFAULT_FAST_MODEL;
  const useWorktrees = Boolean(flags["worktrees"] ?? isGitRepo(cwd));

  header(`GrokGoblin Goblins: ${workerCount} workers`);
  print(dim(`Task: ${task}`));
  print(dim(`Session: ${teamName}`));
  print("");

  const teamStateDir = join(
    resolveGgStateDir(cwd),
    "state",
    "team",
    teamName
  );
  ensureDir(teamStateDir);

  const workers: TeamWorkerConfig[] = [];

  for (let i = 0; i < workerCount; i++) {
    const workerName = `${teamName}-w${i + 1}`;
    const workerTask = `${task} [worker ${i + 1}/${workerCount}: ${workerRole}]`;

    workers.push({
      id: i + 1,
      name: workerName,
      task: workerTask,
      status: "pending",
    });
  }

  const teamState: TeamState = {
    teamName,
    leaderSessionId: sessionId,
    task,
    workerCount,
    workers,
    startedAt: new Date().toISOString(),
    status: "running",
  };

  writeJsonFile(join(teamStateDir, "state.json"), teamState);

  const leaderTmuxSession = `${teamName}-leader`;
  const workerArgs = [
    "-p",
    `You are a grunt worker goblin. Complete this task end-to-end, then verify your work: ${task}`,
    "-m",
    fastModel,
    "--output-format",
    "streaming-json",
  ];

  step(`Starting ${workerCount} worker sessions...`);

  for (let i = 0; i < workerCount; i++) {
    const workerSessionName = `${teamName}-w${i + 1}`;
    tmuxNewSession(workerSessionName, grokBin, workerArgs, cwd);
    ok(`  Worker ${i + 1}: ${workerSessionName}`);
    workers[i].status = "running";
    workers[i].startedAt = new Date().toISOString();
  }

  writeJsonFile(join(teamStateDir, "state.json"), { ...teamState, workers });

  print("");
  ok(`Team ${teamName} running with ${workerCount} workers.`);
  print("");
  print(dim("Monitor with: gg team status " + teamName));
  print(dim("Shutdown with: gg team shutdown " + teamName));
  print(dim("Attach to worker: tmux attach -t " + teamName + "-w1"));
}

async function runTeamStatus(
  cwd: string,
  teamName?: string
): Promise<void> {
  header("Team Status");

  if (!teamName) {
    const sessions = tmuxListSessions().filter((s) =>
      s.startsWith("gg-team-")
    );
    if (sessions.length === 0) {
      print(dim("No active team sessions."));
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
    "team",
    teamName
  );
  const state = readJsonFile<TeamState>(join(stateDir, "state.json"));

  if (!state) {
    warn(`No state found for team: ${teamName}`);
    return;
  }

  print(dim(`Team: ${state.teamName}`));
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

async function runTeamShutdown(
  cwd: string,
  teamName?: string,
  flags: Record<string, string | boolean | number> = {}
): Promise<void> {
  if (!teamName) {
    warn("Specify a team name: gg team shutdown <team-name>");
    process.exit(1);
  }

  header(`Shutting down team: ${teamName}`);

  const sessions = tmuxListSessions().filter((s) =>
    s.startsWith(teamName)
  );

  for (const session of sessions) {
    step(`Killing tmux session: ${session}`);
    tmuxKillSession(session);
    ok(`  ${session} stopped`);
  }

  ok(`Team ${teamName} shut down.`);
}

async function runTeamResume(cwd: string, teamName?: string): Promise<void> {
  if (!teamName) {
    warn("Specify a team name: gg team resume <team-name>");
    process.exit(1);
  }

  const sessions = tmuxListSessions().filter((s) =>
    s.startsWith(teamName)
  );

  if (sessions.length === 0) {
    warn(`No running sessions found for team: ${teamName}`);
    return;
  }

  print(dim(`Resuming team: ${teamName}`));
  print(dim(`Active sessions: ${sessions.join(", ")}`));

  const { tmuxAttach } = await import("../utils/exec.js");
  tmuxAttach(`${teamName}-w1`);
}
