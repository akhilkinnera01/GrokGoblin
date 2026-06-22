import { resolveGrokHome, DEFAULT_FAST_MODEL } from "../utils/paths.js";
import {
  isGitRepo,
  gitRepoRoot,
  commandExists,
  runSync,
  spawnGrokHeadless,
  spawnGrokHeadlessAsync,
} from "../utils/exec.js";
import { createWorktree, removeWorktree } from "../utils/worktree.js";
import { resolveVerifyCommand, runCheck } from "../utils/verify.js";
import { leaderSocketArgs } from "../utils/leader.js";
import { runGoblinsVerified, type LoopOptions } from "./cruise.js";
import { print, header, ok, warn, info, step, dim } from "../utils/print.js";

// True OS-parallel Goblins fan-out. The planner splits the goal into independent
// units (disjoint file scopes); each unit runs as its own grok process in its own
// git worktree so they can't corrupt each other. Completed worktree branches are
// merged back; on a merge conflict we abort that merge (Option A — no risky LLM
// auto-merge) and let the verified loop redo that unit in-tree. Either way the
// run only finishes once the same verification gate as cruise passes.

interface Unit {
  title: string;
  scope: string;
  instructions: string;
}

const WORKER_TIMEOUT_MS = 15 * 60 * 1000;
const WORKER_MAX_TURNS = 30;
const PLAN_TIMEOUT_MS = 3 * 60 * 1000;

// Ask a planner to split the goal into independent, file-disjoint units.
function planUnits(
  goal: string,
  grokHome: string,
  grokBin: string,
  maxUnits: number,
  leaderArgs: string[]
): Unit[] {
  const prompt = [
    "You are a planner. Split the goal below into INDEPENDENT units of work that can run in PARALLEL.",
    "",
    `## Goal\n${goal}`,
    "",
    "## Rules",
    `- Produce AT MOST ${maxUnits} units. Fewer is fine.`,
    "- Units MUST be independent: each touches a DISJOINT set of files/directories — no two units may modify the same file.",
    "- If the goal cannot be cleanly split into independent units (e.g. it's one tightly-coupled change), output an empty array.",
    "",
    "## Output",
    'Output ONLY a JSON array, no prose. Each element: {"title": str, "scope": "files/dirs this unit may modify", "instructions": "what to do"}.',
  ].join("\n");

  const res = spawnGrokHeadless(
    prompt,
    ["-m", DEFAULT_FAST_MODEL, "--always-approve", "--output-format", "plain", ...leaderArgs],
    { ...process.env, GROK_HOME: grokHome },
    grokBin,
    PLAN_TIMEOUT_MS
  );
  const text = (res.stdout || "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Unit[];
    return parsed
      .filter((u) => u && u.title && u.instructions)
      .slice(0, maxUnits)
      .map((u) => ({ title: String(u.title), scope: String(u.scope ?? ""), instructions: String(u.instructions) }));
  } catch {
    return [];
  }
}

function workerPrompt(unit: Unit, goal: string): string {
  return [
    `You are a Goblin worker in an ISOLATED git worktree, working ONE unit of a larger goal.`,
    "",
    `## Overall goal (context only)\n${goal}`,
    "",
    `## Your unit: ${unit.title}`,
    unit.instructions,
    "",
    unit.scope ? `## Scope — only modify files within: ${unit.scope}` : "",
    "Do NOT modify files outside your unit. Make the change complete and self-contained.",
    "Run any quick local check you can to confirm your unit works, then stop.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runGoblinsParallel(
  cwd: string,
  task: string,
  maxWorkers: number,
  options: LoopOptions = {}
): Promise<void> {
  const grokBin = process.env["GROK_BIN"] ?? "grok";
  if (!commandExists(grokBin)) {
    warn("grok CLI not found. Run `goblin setup` first.");
    process.exit(1);
  }
  // Parallel fan-out needs git worktrees for isolation.
  if (!isGitRepo(cwd)) {
    warn("Parallel goblins needs a git repository (for worktree isolation).");
    info("Falling back to the sequential verified loop.");
    await runGoblinsVerified(cwd, task, maxWorkers, "", options);
    return;
  }

  const repoRoot = gitRepoRoot(cwd) ?? cwd;
  const grokHome = resolveGrokHome();
  const leaderArgs = leaderSocketArgs(grokHome, repoRoot);
  const model = options.model ?? DEFAULT_FAST_MODEL;
  const verifyCommand = resolveVerifyCommand(repoRoot, options.verify, Boolean(options.noVerify));

  header("GrokGoblin Goblins (parallel)");
  print(`${dim("task:")}    ${task}`);
  print(`${dim("workers:")} up to ${maxWorkers} (worktree-isolated)`);
  print(`${dim("verify:")}  ${verifyCommand ?? "independent QC reviewer"}`);
  print("");

  step("Planning independent units...");
  const units = planUnits(task, grokHome, grokBin, maxWorkers, leaderArgs);
  if (units.length <= 1) {
    info("Goal doesn't split into independent parallel units — using the sequential verified loop.");
    await runGoblinsVerified(cwd, task, maxWorkers, "", options);
    return;
  }
  ok(`Planned ${units.length} independent unit(s):`);
  units.forEach((u, i) => print(dim(`  ${i + 1}. ${u.title}${u.scope ? ` — ${u.scope}` : ""}`)));
  print("");

  const runId = Date.now().toString(36);
  const worktrees: { name: string; branch: string; path: string; unit: Unit }[] = [];

  // ── Parallel make: one grok process per unit, each in its own worktree ──
  step(`Running ${units.length} goblins in parallel...`);
  const jobs = units.map(async (unit, i) => {
    const name = `gob-${runId}-${i + 1}`;
    let wt;
    try {
      wt = createWorktree(repoRoot, name);
    } catch (e) {
      warn(`  worktree for unit ${i + 1} failed: ${String(e)}`);
      return;
    }
    worktrees.push({ ...wt, unit });
    const res = await spawnGrokHeadlessAsync(workerPrompt(unit, task), [
      "-m", model,
      "--always-approve",
      "--experimental-memory",
      "--max-turns", String(WORKER_MAX_TURNS),
      "--compaction-mode", "segments",
      ...leaderArgs,
    ], {
      env: { ...process.env, GROK_HOME: grokHome },
      grokBin,
      cwd: wt.path,
      timeoutMs: WORKER_TIMEOUT_MS,
    });
    // Commit the worker's output so its branch can be merged back.
    runSync("git", ["add", "-A"], { cwd: wt.path });
    const commit = runSync("git", ["commit", "-m", `goblin: ${unit.title}`], { cwd: wt.path });
    const committed = commit.ok;
    print(
      res.timedOut
        ? dim(`  ⏱ unit "${unit.title}" timed out`)
        : committed
          ? dim(`  ✓ unit "${unit.title}" done`)
          : dim(`  · unit "${unit.title}" made no changes`)
    );
  });
  await Promise.all(jobs);

  // ── Integrate: merge each unit branch into the base; abort conflicts ──
  step("Integrating worktree branches...");
  let merged = 0;
  let conflicts = 0;
  for (const wt of worktrees) {
    const m = runSync("git", ["merge", "--no-edit", wt.branch], { cwd: repoRoot });
    if (m.ok) {
      merged++;
    } else {
      // Option A: don't risk an LLM merge resolution — abort and let the
      // verified loop redo this unit's work in-tree.
      runSync("git", ["merge", "--abort"], { cwd: repoRoot });
      conflicts++;
      print(dim(`  ⚠ "${wt.unit.title}" conflicted on merge — deferring to the verified loop`));
    }
    removeWorktree(repoRoot, wt.name, { force: true, deleteBranch: true });
  }
  print(dim(`  merged ${merged}/${worktrees.length}${conflicts ? `, ${conflicts} deferred` : ""}`));
  print("");

  // ── Verify the integrated result; if not green, drive to completion with the
  //    proven sequential verified loop (it inherits the in-tree parallel work). ──
  if (verifyCommand) {
    step(`Checking integrated result: ${verifyCommand}`);
    const check = runCheck(verifyCommand, repoRoot, 10 * 60 * 1000);
    if (check.ok && conflicts === 0) {
      ok("Parallel result verified — all units integrated and the check passes.");
      return;
    }
    warn(check.ok ? "Check passes but some units were deferred — finishing in the verified loop." : "Integrated check not green yet — finishing in the verified loop.");
  } else {
    info("No deterministic check — running the verified loop to QC-review the integrated result.");
  }

  await runGoblinsVerified(cwd, task, maxWorkers, "", options);
}
