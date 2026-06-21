import { join } from "path";
import { existsSync, readdirSync, rmSync, openSync } from "fs";
import { spawn } from "child_process";
import {
  resolveGgStateDir,
  resolveGrokHome,
  DEFAULT_FAST_MODEL,
} from "../utils/paths.js";
import {
  commandExists,
  gitRepoRoot,
  spawnGrokHeadless,
} from "../utils/exec.js";
import { detectVerifyCommand, runCheck } from "../utils/verify.js";
import { ensureDir, writeJsonFile, readJsonFile } from "../utils/toml.js";
import {
  runRalph,
  runQuest,
  runCruise,
  runGoblinsVerified,
  type LoopResult,
} from "./cruise.js";
import { runGoblinsParallel } from "./parallel.js";
import { print, header, ok, warn, info, step, dim, bold, exitWithError } from "../utils/print.js";

// `gg hunt` — autonomous outcome pursuit (GrokGoblin's answer to Codex /goal).
// One entry point: triage the objective → right-size the strategy → persist a
// completion CONTRACT → pursue it through the verified loop until the evidence
// says done or the budget is spent. Lifecycle: status / pause / resume / clear,
// and `--detach` to run for hours without holding the terminal.

type Strategy = "exec" | "ralph" | "quest" | "cruise" | "goblins-parallel";
type Status = "active" | "paused" | "blocked" | "complete";

interface GoalContract {
  id: string;
  objective: string;
  createdAt: string;
  updatedAt: string;
  status: Status;
  strategy: Strategy;
  verify: string | null;
  constraints: string[];
  workers: number;
  budget: { maxIterations: number; maxTurns: number };
  detached: boolean;
  history: { ts: string; event: string }[];
  result?: { completed: boolean; iterations: number };
}

const DEFAULT_BUDGET = { maxIterations: 30, maxTurns: 60 };

// ── Contract storage (.grokgoblin/goals/<id>/goal.json) ──────────────────────
function goalsRoot(cwd: string): string {
  return join(resolveGgStateDir(cwd), "goals");
}
function contractPath(cwd: string, id: string): string {
  return join(goalsRoot(cwd), id, "goal.json");
}
function logPath(cwd: string, id: string): string {
  return join(goalsRoot(cwd), id, "hunt.log");
}
function saveContract(cwd: string, c: GoalContract): void {
  c.updatedAt = new Date().toISOString();
  ensureDir(join(goalsRoot(cwd), c.id));
  writeJsonFile(contractPath(cwd, c.id), c);
}
function loadContract(cwd: string, id: string): GoalContract | null {
  const p = contractPath(cwd, id);
  return existsSync(p) ? (readJsonFile(p) as GoalContract) : null;
}
function listContracts(cwd: string): GoalContract[] {
  const root = goalsRoot(cwd);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((id) => loadContract(cwd, id))
    .filter((c): c is GoalContract => Boolean(c))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
// The contract a no-id lifecycle command should act on: the most recent that is
// still in play (active/paused), else the most recent overall.
function currentContract(cwd: string): GoalContract | null {
  const all = listContracts(cwd);
  return all.find((c) => c.status === "active" || c.status === "paused") ?? all[0] ?? null;
}

// ── Phase 0: triage — right-size the strategy + draft the completion contract ─
function triage(
  objective: string,
  repoRoot: string,
  grokHome: string,
  grokBin: string
): { strategy: Strategy; verify: string | null; constraints: string[]; workers: number } {
  const detected = detectVerifyCommand(repoRoot);
  const prompt = [
    "You are a triage planner for an autonomous coding agent. Classify the objective and decide the",
    "cheapest strategy that can actually achieve it. Do NOT over-engineer small tasks.",
    "",
    `## Objective\n${objective}`,
    "",
    detected ? `## Detected verification command in this repo\n${detected}` : "## No verification command auto-detected in this repo.",
    "",
    "## Strategies (pick exactly one)",
    "- exec: a trivial one-shot change; a single pass with no loop is enough.",
    "- ralph: one focused task that may need a few self-correcting iterations.",
    "- quest: a multi-step objective best done as an ordered sequence of checkpoints.",
    "- cruise: a full feature needing design + implementation + tests + review.",
    "- goblins-parallel: large work that splits into many INDEPENDENT units (e.g. process N files).",
    "",
    "## Output",
    'Output ONLY a JSON object, no prose: {"strategy": one of the above, "verify": "<shell command that objectively checks success, or empty if none applies>", "constraints": ["..."], "workers": <int 1-8 for goblins-parallel else 1>}.',
  ].join("\n");

  const res = spawnGrokHeadless(
    prompt,
    ["-m", DEFAULT_FAST_MODEL, "--always-approve", "--output-format", "plain"],
    { ...process.env, GROK_HOME: grokHome },
    grokBin,
    3 * 60 * 1000
  );
  const text = (res.stdout || "").trim();
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  let parsed: Record<string, unknown> = {};
  if (s !== -1 && e > s) {
    try {
      parsed = JSON.parse(text.slice(s, e + 1));
    } catch {
      /* fall through to defaults */
    }
  }
  const valid: Strategy[] = ["exec", "ralph", "quest", "cruise", "goblins-parallel"];
  const strategy = valid.includes(parsed["strategy"] as Strategy)
    ? (parsed["strategy"] as Strategy)
    : "ralph"; // safe default
  const verifyRaw = typeof parsed["verify"] === "string" ? (parsed["verify"] as string).trim() : "";
  const verify = verifyRaw || detected || null;
  const constraints = Array.isArray(parsed["constraints"]) ? (parsed["constraints"] as string[]).map(String) : [];
  const workers = Math.min(8, Math.max(1, Number(parsed["workers"]) || 3));
  return { strategy, verify, constraints, workers };
}

// ── Phase 2: pursue the contract through the right verified loop ──────────────
async function pursue(cwd: string, c: GoalContract): Promise<void> {
  const repoRoot = gitRepoRoot(cwd) ?? cwd;
  const grokHome = resolveGrokHome();
  const grokBin = process.env["GROK_BIN"] ?? "grok";

  // Control hook: re-read the contract each iteration so `gg hunt pause/clear`
  // (even from another terminal, even on a detached run) takes effect at the
  // next safe boundary.
  const controlCheck = (): "continue" | "pause" | "stop" => {
    const fresh = loadContract(cwd, c.id);
    if (!fresh) return "stop"; // cleared
    if (fresh.status === "paused") return "pause";
    if (fresh.status !== "active") return "stop";
    return "continue";
  };

  const opts = {
    verify: c.verify ?? undefined,
    noVerify: !c.verify,
    maxIterations: c.budget.maxIterations,
    maxTurns: c.budget.maxTurns,
    skipGitRepoCheck: true,
    controlCheck,
  };

  header(`GrokGoblin hunt — ${c.strategy}`);
  print(`${dim("objective:")} ${c.objective}`);
  print(`${dim("verify:")}    ${c.verify ?? "independent QC reviewer"}`);
  print(`${dim("budget:")}    ${c.budget.maxIterations} iterations · ${c.budget.maxTurns} turns/iter`);
  if (c.constraints.length) print(`${dim("constraints:")} ${c.constraints.join("; ")}`);
  print("");

  let result: LoopResult;
  switch (c.strategy) {
    case "exec": {
      // Trivial: a single pass, no loop — the right-sizing path for small tasks.
      step("Single-pass execution (trivial objective)...");
      const r = spawnGrokHeadless(
        `${c.objective}\n\nMake the change, verify it works, then stop.`,
        ["-m", DEFAULT_FAST_MODEL, "--always-approve", "--experimental-memory", "--output-format", "plain", "--max-turns", String(c.budget.maxTurns)],
        { ...process.env, GROK_HOME: grokHome },
        grokBin,
        15 * 60 * 1000
      );
      if (r.stdout) print(r.stdout);
      // If a deterministic check exists, the single pass is only "complete" when
      // it actually passes — don't claim verified on a bare exit code.
      const execOk = c.verify ? runCheck(c.verify, repoRoot, 5 * 60 * 1000).ok : r.ok;
      result = { completed: execOk, iterations: 1 };
      break;
    }
    case "quest":
      result = await runQuest(cwd, c.objective, opts);
      break;
    case "cruise":
      result = await runCruise(cwd, c.objective, opts);
      break;
    case "goblins-parallel":
      await runGoblinsParallel(cwd, c.objective, c.workers, opts);
      // parallel hands off to the verified loop internally; treat reaching here as a pass-through.
      result = { completed: true, iterations: 1 };
      break;
    case "ralph":
    default:
      result = await runRalph(cwd, c.objective, opts);
      break;
  }

  // Record outcome. halted=pause leaves it paused; otherwise complete/blocked.
  const latest = loadContract(cwd, c.id) ?? c;
  latest.result = { completed: result.completed, iterations: result.iterations };
  if (result.halted === "pause") {
    latest.status = "paused";
    latest.history.push({ ts: new Date().toISOString(), event: "paused mid-run" });
  } else if (result.completed) {
    latest.status = "complete";
    latest.history.push({ ts: new Date().toISOString(), event: `completed in ${result.iterations} iteration(s)` });
    ok(`Hunt complete: objective achieved and verified.`);
  } else {
    latest.status = "blocked";
    latest.history.push({ ts: new Date().toISOString(), event: `stopped (budget/stall) after ${result.iterations} iteration(s)` });
    warn(`Hunt stopped without completion — review state and resume with: gg hunt resume ${c.id}`);
  }
  saveContract(cwd, latest);
}

// Spawn a detached process to pursue the goal so it survives the terminal.
function detachPursue(cwd: string, id: string): void {
  const entry = process.env["GG_ENTRY_PATH"] ?? process.argv[1];
  const out = openSync(logPath(cwd, id), "a");
  const child = spawn(process.execPath, [entry, "hunt", "--_run", id], {
    cwd,
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
  });
  child.unref();
  ok(`Hunt running detached (pid ${child.pid}).`);
  print(dim(`  logs:   tail -f ${logPath(cwd, id)}`));
  print(dim(`  status: gg hunt`));
  print(dim(`  pause:  gg hunt pause ${id}`));
}

// ── Dispatcher ───────────────────────────────────────────────────────────────
export async function runHunt(
  cwd: string,
  args: string[],
  flags: Record<string, string | boolean | number>
): Promise<void> {
  const grokBin = process.env["GROK_BIN"] ?? "grok";
  const sub = args[0];

  // Internal: detached worker entry — pursue an existing contract by id.
  if (flags["_run"]) {
    const id = String(flags["_run"]);
    const c = loadContract(cwd, id);
    if (!c) exitWithError(`No goal contract found for id ${id}`);
    c!.status = "active";
    saveContract(cwd, c!);
    await pursue(cwd, c!);
    return;
  }

  // Lifecycle subcommands.
  if (sub === "status" || args.length === 0) {
    return printStatus(cwd);
  }
  if (sub === "pause" || sub === "resume" || sub === "clear") {
    return lifecycle(cwd, sub, args[1]);
  }

  // Create a new hunt from an objective.
  if (!commandExists(grokBin)) exitWithError("grok not found on PATH. Run `gg setup` first.");
  const objective = args.join(" ").trim();
  if (!objective) {
    warn('gg hunt needs an objective. Example: gg hunt "migrate the config loader to zod and keep tests green"');
    return;
  }
  const repoRoot = gitRepoRoot(cwd) ?? cwd;
  const grokHome = resolveGrokHome();

  header("GrokGoblin hunt — triage");
  print(`${dim("objective:")} ${objective}`);
  step("Triaging objective (right-sizing the strategy)...");
  const t = triage(objective, repoRoot, grokHome, grokBin);

  const id = `g-${Date.now().toString(36)}`;
  const contract: GoalContract = {
    id,
    objective,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
    strategy: t.strategy,
    verify: t.verify,
    constraints: t.constraints,
    workers: t.workers,
    budget: {
      maxIterations: flags["max-iterations"] ? Number(flags["max-iterations"]) : DEFAULT_BUDGET.maxIterations,
      maxTurns: flags["max-turns"] ? Number(flags["max-turns"]) : DEFAULT_BUDGET.maxTurns,
    },
    detached: Boolean(flags["detach"]),
    history: [{ ts: new Date().toISOString(), event: `created (strategy=${t.strategy})` }],
  };
  saveContract(cwd, contract);

  ok(`Strategy: ${bold(t.strategy)} · verify: ${t.verify ?? "independent QC reviewer"} · id ${id}`);
  print("");

  if (contract.detached) {
    detachPursue(cwd, id);
  } else {
    await pursue(cwd, contract);
  }
}

function lifecycle(cwd: string, action: string, idArg?: string): void {
  const c = idArg ? loadContract(cwd, idArg) : currentContract(cwd);
  if (!c) {
    warn(idArg ? `No goal found for id ${idArg}` : "No goals found.");
    return;
  }
  if (action === "pause") {
    c.status = "paused";
    c.history.push({ ts: new Date().toISOString(), event: "pause requested" });
    saveContract(cwd, c);
    ok(`Hunt ${c.id} will pause at the next iteration boundary.`);
  } else if (action === "resume") {
    if (c.status === "complete") return void info(`Hunt ${c.id} already complete.`);
    c.status = "active";
    c.history.push({ ts: new Date().toISOString(), event: "resume requested" });
    saveContract(cwd, c);
    ok(`Resuming hunt ${c.id} (detached).`);
    detachPursue(cwd, c.id);
  } else if (action === "clear") {
    rmSync(join(goalsRoot(cwd), c.id), { recursive: true, force: true });
    ok(`Cleared hunt ${c.id}. (A running detached process will stop at its next boundary.)`);
  }
}

function printStatus(cwd: string): void {
  const all = listContracts(cwd);
  header("GrokGoblin hunts");
  if (!all.length) {
    print(dim("No hunts yet. Start one: gg hunt \"<objective>\""));
    return;
  }
  for (const c of all) {
    const mark =
      c.status === "complete" ? "✓" : c.status === "blocked" ? "⚠" : c.status === "paused" ? "⏸" : "→";
    print(`${mark} ${bold(c.id)}  ${dim(`[${c.status}/${c.strategy}]`)}  ${c.objective.slice(0, 70)}`);
    const last = c.history[c.history.length - 1];
    if (last) print(dim(`    last: ${last.event} (${last.ts.slice(0, 19).replace("T", " ")})`));
    if (c.status === "active" || c.status === "paused") print(dim(`    logs: ${logPath(cwd, c.id)}`));
  }
}
