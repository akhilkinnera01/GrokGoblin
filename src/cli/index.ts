import { cwd as getCwd } from "process";
import { GG_VERSION, DEFAULT_FAST_MODEL } from "../utils/paths.js";
import { print, warn, exitWithError, bold, dim, header } from "../utils/print.js";
import type { LaunchOptions, SetupOptions } from "../types/index.js";

type CliCommand =
  | "launch"
  | "setup"
  | "update"
  | "uninstall"
  | "doctor"
  | "exec"
  | "ask"
  | "explore"
  | "forage"
  | "memory"
  | "list"
  | "cruise"
  | "quest"
  | "config"
  | "skills"
  | "hooks"
  | "hook"
  | "version"
  | "help"
  | "goblins"
  | "team"
  | "ralph"
  | "hunt"
  | "goal"
  | "review"
  | "ship"
  | "state"
  | "session"
  | "agents"
  | "worktree"
  | "wt"
  | "hud";

interface ResolvedCliInvocation {
  command: CliCommand;
  args: string[];
  flags: Record<string, string | boolean | number>;
}

// Flags that are always boolean — they must NEVER consume the following token as
// their value, otherwise e.g. `gg exec --berserk "prompt"` would swallow the
// prompt. Anything not listed here may take a value (`--model grok-build`).
const BOOLEAN_FLAGS = new Set([
  "berserk", "yolo", "high", "xhigh", "direct", "tmux", "fast", "plan", "ask",
  "check", "force", "verbose", "team", "mcp", "skip-git-repo-check",
  "always-approve", "history", "branch", "all", "merged", "help", "version",
  "merge-agents", "continue", "no-subagents", "no-digest", "no-verify", "once",
  "goblins", "parallel", "detach", "relentless",
  "staged", "post", "pr", "push",
]);

function parseArgs(argv: string[]): {
  positional: string[];
  flags: Record<string, string | boolean | number>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean | number> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq !== -1 ? arg.slice(2, eq) : arg.slice(2);
      if (eq !== -1) {
        flags[name] = arg.slice(eq + 1);
      } else if (
        !BOOLEAN_FLAGS.has(name) &&
        i + 1 < argv.length &&
        !argv[i + 1].startsWith("-")
      ) {
        flags[name] = argv[i + 1];
        i++;
      } else {
        flags[name] = true;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const shortMap: Record<string, string> = {
        h: "help",
        v: "version",
        w: "worktree",
        m: "model",
        p: "prompt",
        s: "session",
        c: "continue",
      };
      const full = shortMap[arg.slice(1)];
      if (full) {
        if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
          flags[full] = argv[i + 1];
          i++;
        } else {
          flags[full] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

function resolveCliInvocation(argv: string[]): ResolvedCliInvocation {
  const { positional, flags } = parseArgs(argv);

  if (flags["help"] || flags["h"]) {
    return { command: "help", args: positional, flags };
  }

  if (flags["version"] || flags["v"]) {
    return { command: "version", args: positional, flags };
  }

  const knownCommands: Set<CliCommand> = new Set([
    "setup",
    "update",
    "uninstall",
    "doctor",
    "exec",
    "ask",
    "explore",
    "forage",
    "memory",
    "list",
    "cruise",
    "quest",
    "config",
    "skills",
    "hooks",
    "hook",
    "version",
    "help",
    "goblins",
    "team",
    "ralph",
    "hunt",
    "goal",
    "review",
    "ship",
    "state",
    "session",
    "agents",
    "worktree",
    "wt",
    "hud",
  ]);

  const first = positional[0] as CliCommand | undefined;
  if (first && knownCommands.has(first)) {
    return { command: first, args: positional.slice(1), flags };
  }

  return { command: "launch", args: positional, flags };
}

function printHelp(): void {
  header(`GrokGoblin (gg) v${GG_VERSION}`);
  print(dim("A multi-agent orchestration layer for the xAI Grok CLI"));
  print(dim("Native multi-agent orchestration for grok — built by akhilkinnera01"));
  print("");
  print(bold("Usage:"));
  print("  gg [command] [options]");
  print("");
  print(bold("Launch (default):"));
  print("  gg                         Launch grok with GrokGoblin enhancement");
  print("  gg -w                      Launch in a fresh isolated worktree (auto-named)");
  print("  gg -w feat/task            Launch in a named worktree");
  print("  gg --berserk               Launch with always-approve mode (no prompts)");
  print("  gg --high                  High reasoning effort (headless only)");
  print("  gg --fast                  Launch with grok-composer-2.5-fast model");
  print("  gg --plan                  Launch in plan mode (headless only)");
  print("  gg --direct                Launch without tmux management");
  print("  gg --tmux                  Launch in detached tmux session");
  print("");
  print(bold("Setup & Maintenance:"));
  print("  gg setup                   Install GrokGoblin skills, hooks, AGENTS.md");
  print("  gg setup --scope project   Install to .grok/ (project scope)");
  print("  gg setup --force           Force overwrite existing files");
  print("  gg update                  Update GrokGoblin and refresh setup");
  print("  gg uninstall               Remove GrokGoblin hooks and config");
  print("  gg doctor                  Check installation health");
  print("  gg doctor --verbose        Show fix commands for each issue");
  print("  gg doctor --goblins        Also check goblins --tmux mode requirements");
  print("");
  print(bold("Skills:"));
  print("  gg skills list             List installed skills");
  print("  gg skills info <name>      Show skill documentation");
  print("  gg skills refresh          Re-install all skills");
  print("");
  print(bold("Execution:"));
  print("  gg ask <question>          Quick one-shot question (no repo needed)");
  print("  gg explore <topic>         Read-only investigation (no edits)");
  print("  gg forage <topic>          Multi-facet read-only research (parallel goblins + live web/X)");
  print("  gg exec <prompt>           Run a headless grok task");
  print("  gg exec --check            Test grok authentication");
  print("  gg exec --effort high <p>  Headless task with high reasoning effort");
  print("");
  print(bold("Config (grok config.toml):"));
  print("  gg config                  Show GrokGoblin-managed grok settings");
  print("  gg config get <key>        Read a config value (e.g. models.default)");
  print("  gg config set <key> <val>  Write a config value");
  print("  gg config model fast       Set default model to grok-composer-2.5-fast");
  print("");
  print(bold("Memory & discovery:"));
  print("  gg memory [status|search|on|off|edit]     Persistent cross-session project memory");
  print("  gg list [skills|agents|cruise|sessions]   List installed/tracked items");
  print("");
  print(bold("Workflows (autonomous loops with a verification gate):"));
  print("  gg cruise <goal>           Full pipeline loop: dig→goblinplan→quest→tdd→code-review");
  print("  gg quest <goal>            Durable multi-goal loop with checkpoints");
  print("  gg ralph <task>            Persistent single-task completion loop");
  print("  gg hunt \"<objective>\"       Autonomous goal: triage → pursue until verified (--detach to run for hours)");
  print(dim("    hunt lifecycle: gg hunt (status) · gg hunt pause|resume|clear [id]"));
  print("  gg review [PR#|range]      Independent 2-lane code review (nitpicker + warden), severity-rated · --staged --post");
  print("  gg ship [message]          Verify → style-matched commit on a safe branch · --pr (push + open PR) --no-verify");
  print("  gg goblins [N] <task>      Verified multi-goblin loop: fan out to N goblins, gate until correct");
  print(dim("    goblins flags: --parallel (worktree-isolated fan-out) --once (single-shot) --tmux (panes)"));
  print(dim("  loop flags: --max-iterations <n> --max-turns <n> --verify \"<cmd>\" --no-verify --fast --model <id> --best-of <n> --skip-git-repo-check"));
  print("");
  print(bold("Worktrees (isolated workspaces):"));
  print("  gg worktree                List worktrees (status, age, branch)");
  print("  gg worktree new [name]     Create one (smart goblin name if omitted)");
  print("  gg worktree rm <name>      Remove one (--force, --branch)");
  print("  gg worktree clean          Remove merged, clean worktrees");
  print("");
  print(bold("Hooks:"));
  print("  gg hooks list              List registered hooks");
  print("  gg hook <event>            Dispatch a hook event (used by hooks.json)");
  print("");
  print(bold("Agents:"));
  print("  gg agents list             List available agent roles");
  print("");
  print(bold("State:"));
  print("  gg state list              Show active workflow modes");
  print("  gg state clear             Clear all mode state");
  print("");
  print(bold("Info:"));
  print("  gg version                 Print version");
  print("  gg help                    Print this help");
  print("");
  print(bold("In-session skills (invoke inside grok with /<name>):"));
  print("  /dig                        Structured requirements clarification");
  print("  /goblinplan                 Planning + tradeoff synthesis");
  print("  /ralph                      Persistent completion loop");
  print("  /quest                      Durable multi-goal execution");
  print("  /cruise                     Full pipeline: dig→goblinplan→quest→tdd→code-review");
  print("  /code-review                Code/PR review");
  print("  /tdd                        Test-driven development");
  print("  /goblins                    Parallel execution");
  print("");
  print(bold("Environment variables:"));
  print("  XAI_API_KEY                 xAI API key (optional; or use `grok login`)");
  print("  GROK_HOME                   Override ~/.grok location");
  print("  GG_ROOT                    Override .grokgoblin/ state directory");
  print("  GG_SESSION_ID              Explicit session ID");
  print("  GG_LAUNCH_POLICY           direct|tmux|detached-tmux|auto");
  print("  GROK_BIN                    Override grok binary path");
  print("  GG_HOOK_TIMEOUT_MS         Hook dispatch timeout (default: 8000)");
  print("");
}

function printVersion(): void {
  print(`grokgoblin v${GG_VERSION}`);
}

async function runAgentsList(): Promise<void> {
  const { AGENT_DEFINITIONS } = await import("../agents/definitions.js");
  const { header, print, bold, dim } = await import("../utils/print.js");

  header("GrokGoblin Agent Roles");
  print("");
  for (const [name, def] of Object.entries(AGENT_DEFINITIONS)) {
    print(`  ${bold(name.padEnd(20))} ${dim(def.description.slice(0, 70))}`);
  }
  print("");
}

async function runStateList(cwd: string): Promise<void> {
  const { getActiveModes, readModeState } = await import("../state/mode-state.js");
  const { header, print, dim } = await import("../utils/print.js");
  const { listActiveSkills } = await import("../state/skill-active.js");

  header("GrokGoblin Workflow State");
  print(dim(`state dir: ${cwd}/.grokgoblin/state`));
  print("");

  const active = getActiveModes(cwd);
  if (active.length === 0) {
    print(dim("No active workflow modes."));
  } else {
    for (const mode of active) {
      const state = readModeState(mode, cwd);
      if (state) {
        print(`  ${mode}: phase=${state.currentPhase}, iter=${state.iteration}`);
        print(dim(`    task: ${state.taskDescription.slice(0, 80)}`));
      }
    }
  }

  print("");
  const skills = listActiveSkills(cwd);
  if (skills.length > 0) {
    print(`Active skills: ${skills.join(", ")}`);
  }
}

export async function main(argv: string[]): Promise<void> {
  const cwd = process.env["GG_STARTUP_CWD"] ?? getCwd();
  const invocation = resolveCliInvocation(argv);
  const { command, args, flags } = invocation;

  switch (command) {
    case "help":
      printHelp();
      break;

    case "version":
      printVersion();
      break;

    case "launch": {
      const { runLaunch } = await import("./launch.js");
      const launchOptions: LaunchOptions = {
        worktree: flags["worktree"] as string | boolean | undefined,
        berserk: Boolean(flags["berserk"]),
        yolo: Boolean(flags["yolo"]),
        high: Boolean(flags["high"]),
        xhigh: Boolean(flags["xhigh"]),
        direct: Boolean(flags["direct"]),
        tmux: Boolean(flags["tmux"]),
        model: flags["model"] as string | undefined,
        fast: Boolean(flags["fast"]),
        mode: flags["plan"]
          ? "plan"
          : flags["ask"]
          ? "ask"
          : flags["mode"] as string | undefined as any,
        parallel: flags["parallel"] ? Number(flags["parallel"]) : undefined,
      };
      await runLaunch(cwd, launchOptions, args);
      break;
    }

    case "setup": {
      const { runSetup } = await import("./setup.js");
      const setupOptions: SetupOptions = {
        scope: flags["scope"] as "user" | "project" | undefined,
        force: Boolean(flags["force"]),
        mergeAgents: Boolean(flags["merge-agents"]),
        team: flags["team"] !== false,
        mcp: Boolean(flags["mcp"]),
      };
      await runSetup(cwd, setupOptions);
      break;
    }

    case "uninstall": {
      const { runUninstall } = await import("./setup.js");
      await runUninstall(cwd);
      break;
    }

    case "update": {
      const { runSync } = await import("../utils/exec.js");
      print("Checking for updates...");
      const result = runSync("npm", ["install", "-g", "grokgoblin"]);
      if (result.ok) {
        print("Updated to latest. Re-running setup...");
        const { runSetup } = await import("./setup.js");
        await runSetup(cwd, { force: false });
      } else {
        warn("npm update failed. Check your npm setup.");
        process.exit(1);
      }
      break;
    }

    case "doctor": {
      const { runDoctor } = await import("./doctor.js");
      await runDoctor(cwd, {
        verbose: Boolean(flags["verbose"]),
        team: Boolean(flags["goblins"] || flags["team"]),
      });
      break;
    }

    case "config": {
      const { runConfig } = await import("./config.js");
      await runConfig(cwd, args);
      break;
    }

    case "memory": {
      const { runMemory } = await import("./memory.js");
      await runMemory(cwd, args);
      break;
    }

    case "ask": {
      // Quick one-shot question: headless, plain output, no git repo required.
      const { runExec } = await import("./launch.js");
      const question = args.join(" ").trim();
      if (!question) exitWithError("gg ask requires a question, e.g. `gg ask \"how do I ...\"`");
      await runExec(cwd, question, {
        model: Boolean(flags["fast"]) ? DEFAULT_FAST_MODEL : undefined,
        outputFormat: "plain",
        skipGitRepoCheck: true,
      });
      break;
    }

    case "explore": {
      // Read-only investigation: headless, restricted to read/search tools, no edits.
      const { runExec } = await import("./launch.js");
      const topic = args.join(" ").trim();
      if (!topic) exitWithError('gg explore requires a topic, e.g. `gg explore "how does auth work"`');
      await runExec(cwd, `Investigate and explain (read-only, do NOT modify files): ${topic}`, {
        model: Boolean(flags["fast"]) ? DEFAULT_FAST_MODEL : undefined,
        outputFormat: "plain",
        skipGitRepoCheck: true,
        // Core read-only tools. Note: adding web_search/web_fetch here triggers a
        // grok agent-build error (run_terminal_cmd background-param conflict).
        tools: "read_file,grep,list_dir",
      });
      break;
    }

    case "list": {
      const { runList } = await import("./list.js");
      await runList(cwd, args);
      break;
    }

    case "forage": {
      const { runForage } = await import("./forage.js");
      const facetsRaw = flags["facets"] as string | undefined;
      await runForage(cwd, args.join(" ").trim(), {
        facets: facetsRaw ? Number(facetsRaw) : undefined,
        model: flags["model"] as string | undefined,
        out: flags["out"] as string | undefined,
      });
      break;
    }

    case "cruise": {
      // Autonomous headless loop that iterates grok until the goal is complete.
      const { runCruise } = await import("./cruise.js");
      const goal = args.join(" ").trim();
      const maxRaw = flags["max-iterations"] as string | undefined;
      await runCruise(cwd, goal, {
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
      break;
    }

    case "quest": {
      // Durable multi-goal decomposition — runs as an autonomous, checkpointed
      // loop (not a single headless turn) so it actually drives to completion.
      const goal = args.join(" ").trim();
      if (!goal) exitWithError("gg quest requires a goal description");
      const { runQuest } = await import("./cruise.js");
      const maxRaw = flags["max-iterations"] as string | undefined;
      await runQuest(cwd, goal, {
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
      break;
    }

    case "exec": {
      const { runExec } = await import("./launch.js");
      const prompt = args[0];
      const isCheck = Boolean(flags["check"]);
      const actualPrompt = isCheck
        ? "Reply with exactly: GrokGoblin-EXEC-OK"
        : prompt;
      if (!actualPrompt) {
        exitWithError("gg exec requires a prompt argument or --check");
      }
      const fastExec = Boolean(flags["fast"]);
      await runExec(cwd, actualPrompt, {
        check: isCheck,
        model:
          (flags["model"] as string | undefined) ??
          (fastExec ? DEFAULT_FAST_MODEL : undefined),
        outputFormat: flags["output-format"] as string | undefined,
        skipGitRepoCheck: Boolean(flags["skip-git-repo-check"]) || isCheck,
        effort: flags["effort"] as string | undefined,
        berserk: Boolean(flags["berserk"]) || Boolean(flags["always-approve"]),
        bestOf: flags["best-of"] ? Number(flags["best-of"]) : undefined,
      });
      break;
    }

    case "skills": {
      const subCmd = args[0];
      if (!subCmd || subCmd === "list") {
        const { runSkillsList } = await import("./skills.js");
        await runSkillsList(cwd);
      } else if (subCmd === "info" && args[1]) {
        const { runSkillsInfo } = await import("./skills.js");
        await runSkillsInfo(cwd, args[1]);
      } else if (subCmd === "refresh") {
        const { runSkillsRefresh } = await import("./skills.js");
        await runSkillsRefresh(cwd);
      } else {
        exitWithError(`Unknown skills subcommand: ${subCmd}`);
      }
      break;
    }

    case "hooks": {
      const { runHooksList } = await import("./hooks.js");
      await runHooksList(cwd);
      break;
    }

    case "hook": {
      const event = args[0] ?? flags["event"] as string;
      if (!event) exitWithError("gg hook requires an event name");
      const { runHookDispatch } = await import("./hooks.js");
      await runHookDispatch(cwd, event);
      break;
    }

    case "agents": {
      const subCmd = args[0];
      if (!subCmd || subCmd === "list") {
        await runAgentsList();
      } else {
        exitWithError(`Unknown agents subcommand: ${subCmd}`);
      }
      break;
    }

    case "state": {
      const subCmd = args[0];
      if (!subCmd || subCmd === "list") {
        await runStateList(cwd);
      } else if (subCmd === "clear") {
        const { rmSync, mkdirSync } = await import("fs");
        const { join } = await import("path");
        const { resolveGgStateDir } = await import("../utils/paths.js");
        const { ok, exitWithError } = await import("../utils/print.js");
        const stateDir = join(resolveGgStateDir(cwd), "state");
        try {
          rmSync(stateDir, { recursive: true, force: true });
          mkdirSync(stateDir, { recursive: true });
          ok("Cleared all workflow mode state in .grokgoblin/state/");
        } catch (e: any) {
          exitWithError(`Failed to clear state: ${e.message}`);
        }
      } else {
        exitWithError(`Unknown state subcommand: ${subCmd}`);
      }
      break;
    }

    case "goblins":
    case "team": {
      // `team` is a hidden back-compat alias; the feature is Goblins.
      const { runGoblins } = await import("./goblins.js");
      await runGoblins(cwd, args, flags);
      break;
    }

    case "hunt":
    case "goal": {
      // `goal` is an alias for discoverability; the feature is Hunt.
      const { runHunt } = await import("./hunt.js");
      await runHunt(cwd, args, flags);
      break;
    }

    case "review": {
      const { runReview } = await import("./review.js");
      await runReview(cwd, args, flags);
      break;
    }

    case "ship": {
      const { runShip } = await import("./ship.js");
      await runShip(cwd, args, flags);
      break;
    }

    case "worktree":
    case "wt": {
      const { runWorktree } = await import("./worktree.js");
      await runWorktree(cwd, args, flags);
      break;
    }

    case "hud": {
      warn("HUD is available in tmux sessions. Launch with `gg --tmux`.");
      break;
    }

    case "session": {
      const { runSessionInfo } = await import("./session.js");
      await runSessionInfo(cwd, args);
      break;
    }

    case "ralph": {
      // Persistent single-task completion — autonomous loop with a verification
      // gate, rather than one headless turn that would exit after setup.
      const task = args.join(" ").trim();
      if (!task) exitWithError("gg ralph requires a task description");
      const { runRalph } = await import("./cruise.js");
      const maxRaw = flags["max-iterations"] as string | undefined;
      await runRalph(cwd, task, {
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
      break;
    }

    default: {
      printHelp();
      process.exit(1);
    }
  }
}
