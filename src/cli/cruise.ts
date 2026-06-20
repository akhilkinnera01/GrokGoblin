import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { resolveGrokHome, DEFAULT_FAST_MODEL, resolveProjectMemoryPath } from "../utils/paths.js";
import { isGitRepo, gitRepoRoot, spawnGrokHeadless } from "../utils/exec.js";
import { commandExists } from "../utils/exec.js";
import {
  print,
  header,
  ok,
  warn,
  info,
  step,
  dim,
  exitWithError,
} from "../utils/print.js";

// Shared completion sentinels for every GrokGoblin autonomous loop. Keeping one
// pair means cruise/quest/ralph all drive to completion the same reliable way.
const COMPLETE_SENTINEL = "GG-COMPLETE";
const CONTINUE_SENTINEL = "GG-CONTINUE";
// Back-compat: older cruise prompts emitted CRUISE-COMPLETE; still honor it.
const LEGACY_COMPLETE = "CRUISE-COMPLETE";
const DEFAULT_MAX_ITERATIONS = 8;

export interface LoopOptions {
  maxIterations?: number;
  model?: string;
  fast?: boolean;
  skipGitRepoCheck?: boolean;
  /** grok --best-of-n: run each iteration N ways in parallel and keep the best. */
  bestOf?: number;
  /** Write a memory digest at the end of the run (default true). */
  digest?: boolean;
}

// Keep the injected project-memory file bounded so it doesn't bloat the prompt.
const MAX_MEMORY_FILE_BYTES = 24_000;

// Append a concise, durable digest of this run to the GrokGoblin project memory
// file (.grokgoblin/memory/project.md), which the launch overlay injects into
// AGENTS.md next session — so the next session recalls what this run accomplished.
function writeMemoryDigest(
  repoRoot: string,
  kind: string,
  goal: string,
  completed: boolean,
  iterations: number,
  progressPath: string
): string | null {
  try {
    const memPath = resolveProjectMemoryPath(repoRoot);
    mkdirSync(dirname(memPath), { recursive: true });

    const progress = existsSync(progressPath) ? readFileSync(progressPath, "utf-8") : "";
    const lastSummary = lastIterationSummary(progress);
    const entry = [
      `## ${new Date().toISOString().slice(0, 10)} — ${kind} (${completed ? "completed" : "stopped"})`,
      `**Goal:** ${goal.trim()}`,
      `**Iterations:** ${iterations}${completed ? " · verified complete" : " · stopped before completion"}`,
      lastSummary ? `**Outcome:** ${lastSummary}` : "",
      "",
    ]
      .filter(Boolean)
      .join("\n");

    const existing = existsSync(memPath) ? readFileSync(memPath, "utf-8") : "# Project memory\n\n";
    let next = existing.trimEnd() + "\n\n" + entry + "\n";
    // Bound the file: keep the most recent content if it grows too large.
    if (Buffer.byteLength(next, "utf-8") > MAX_MEMORY_FILE_BYTES) {
      next = "# Project memory\n\n" + tail(next, MAX_MEMORY_FILE_BYTES - 200);
    }
    writeFileSync(memPath, next, "utf-8");
    return memPath;
  } catch {
    return null;
  }
}

// Pull a compact one-paragraph outcome from the last iteration block of progress.md.
function lastIterationSummary(progress: string): string {
  if (!progress.trim()) return "";
  const blocks = progress.split(/\n## Iteration \d+\n/).filter((b) => b.trim());
  const last = blocks[blocks.length - 1] ?? "";
  return last.replace(/\s+/g, " ").trim().slice(0, 400);
}

// Back-compat alias for the previous public name.
export type CruiseOptions = LoopOptions;

interface LoopSpec {
  /** Display + state-dir label, e.g. "cruise" | "quest" | "ralph". */
  kind: string;
  /** Human title for the header banner. */
  title: string;
  /** Builds the per-iteration prompt. */
  buildPrompt: (ctx: {
    goal: string;
    iteration: number;
    maxIterations: number;
    progressSoFar: string;
  }) => string;
}

// Reusable verification gate appended to every loop prompt so "verify before
// done" just happens by default — never claim completion on unverified code.
function verificationGate(): string[] {
  return [
    "## Verification gate (mandatory before completing)",
    `- You may ONLY output \`${COMPLETE_SENTINEL}\` if you have just RUN the project's build/tests/linters and they PASS.`,
    "- If there is no test/build command, state explicitly how you verified the goal is met.",
    "- If verification fails or you couldn't verify, keep going — do NOT claim completion.",
    "",
    "## Required final line",
    "End your response with EXACTLY one of these on its own line:",
    `- \`${COMPLETE_SENTINEL}\` — goal fully achieved AND verified (tests/build pass).`,
    `- \`${CONTINUE_SENTINEL}\` — more work remains for the next iteration.`,
  ];
}

function buildCruisePrompt(ctx: {
  goal: string;
  iteration: number;
  maxIterations: number;
  progressSoFar: string;
}): string {
  return [
    "You are running autonomously inside `gg cruise` — a headless loop that re-invokes you each iteration to drive a task end-to-end.",
    `Iteration ${ctx.iteration} of at most ${ctx.maxIterations}.`,
    "",
    "## Goal",
    ctx.goal,
    "",
    "## GrokGoblin pipeline (follow in order, tracking where you are across iterations)",
    "1. **dig** — clarify scope, requirements and explicit non-goals.",
    "2. **goblinplan** — turn the clarified scope into an architecture + step plan.",
    "3. **quest** — execute the plan as discrete, checkpointed goals.",
    "4. **tdd** — cover the work with tests (write/extend tests, make them pass).",
    "5. **code-review** — self-review for correctness, edge cases and regressions; fix what you find.",
    "",
    "## Progress so far (from previous iterations)",
    ctx.progressSoFar.trim() || "(none yet — this is the first iteration)",
    "",
    "## Instructions",
    "- Advance the pipeline THIS iteration; make concrete, incremental progress (edit files, run commands, fix failures).",
    "- Do not re-do completed work. Build on it. Note which pipeline phase you are in.",
    "- Recall relevant prior decisions from memory (memory_search) before changing direction.",
    "- Keep your response focused: what you did, what phase you're in, what remains.",
    "",
    ...verificationGate(),
  ].join("\n");
}

function buildQuestPrompt(ctx: {
  goal: string;
  iteration: number;
  maxIterations: number;
  progressSoFar: string;
}): string {
  return [
    "You are running autonomously inside `gg quest` — a durable, checkpointed multi-goal loop that re-invokes you each iteration.",
    `Iteration ${ctx.iteration} of at most ${ctx.maxIterations}.`,
    "",
    "## Overall objective",
    ctx.goal,
    "",
    "## Ledger so far (completed checkpoints from previous iterations)",
    ctx.progressSoFar.trim() || "(none yet — this is the first iteration)",
    "",
    "## Instructions",
    "- If this is the first iteration, decompose the objective into a short ordered list of discrete, verifiable sub-goals (the quest ledger) and state it.",
    "- Then complete the NEXT incomplete sub-goal this iteration. One checkpoint at a time.",
    "- For the sub-goal you complete, record concrete completion evidence (commands run + result).",
    "- Recall prior decisions from memory (memory_search) before changing direction.",
    "",
    ...verificationGate(),
  ].join("\n");
}

function buildRalphPrompt(ctx: {
  goal: string;
  iteration: number;
  maxIterations: number;
  progressSoFar: string;
}): string {
  return [
    "You are running autonomously inside `gg ralph` — a persistent completion loop for a single task that re-invokes you each iteration until it's truly done.",
    `Iteration ${ctx.iteration} of at most ${ctx.maxIterations}.`,
    "",
    "## Task",
    ctx.goal,
    "",
    "## Progress so far (from previous iterations)",
    ctx.progressSoFar.trim() || "(none yet — this is the first iteration)",
    "",
    "## Instructions",
    "- Make concrete progress toward fully completing the task this iteration.",
    "- Reflect briefly on what's left and tackle the most important remaining piece.",
    "- Do not re-do completed work. Recall prior decisions from memory (memory_search).",
    "",
    ...verificationGate(),
  ].join("\n");
}

async function runLoop(
  cwd: string,
  goal: string,
  spec: LoopSpec,
  options: LoopOptions = {}
): Promise<void> {
  const grokBin = process.env["GROK_BIN"] ?? "grok";
  const grokHome = resolveGrokHome();

  if (!commandExists(grokBin)) {
    exitWithError("grok not found on PATH. Install grok first.");
  }
  if (!goal.trim()) {
    exitWithError(`gg ${spec.kind} requires a goal, e.g. \`gg ${spec.kind} "add tests for parser"\``);
  }
  if (!options.skipGitRepoCheck && !isGitRepo(cwd)) {
    exitWithError(`Not in a git repository. ${spec.kind} edits code — run inside a repo or pass --skip-git-repo-check.`);
  }

  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const model = options.model ?? (options.fast ? DEFAULT_FAST_MODEL : undefined);

  const repoRoot = gitRepoRoot(cwd) ?? cwd;
  const runId = `${Date.now()}`;
  const runDir = join(repoRoot, ".grokgoblin", spec.kind, runId);
  mkdirSync(runDir, { recursive: true });
  const logPath = join(runDir, "log.jsonl");
  const progressPath = join(runDir, "progress.md");
  writeFileSync(join(runDir, "goal.md"), `# ${spec.title} goal\n\n${goal}\n`, "utf-8");
  writeFileSync(progressPath, "", "utf-8");

  header(`GrokGoblin ${spec.title}`);
  print(`${dim("goal:")}  ${goal}`);
  print(`${dim("model:")} ${model ?? "(grok default)"}`);
  print(`${dim("max:")}   ${maxIterations} iterations`);
  print(`${dim("state:")} ${runDir}`);
  print("");

  const grokArgs = ["--always-approve", "--experimental-memory", "--output-format", "plain"];
  // segments compaction persists compacted history as grep-able markdown, so a
  // long iteration can recover earlier detail instead of losing it to the window.
  grokArgs.push("--compaction-mode", "segments");
  if (model) grokArgs.push("-m", model);
  // --best-of-n runs the turn N ways in parallel and keeps the best (headless only).
  if (options.bestOf && options.bestOf > 1) {
    grokArgs.push("--best-of-n", String(options.bestOf));
  }

  let completed = false;
  let iterationsRun = 0;
  for (let i = 1; i <= maxIterations; i++) {
    iterationsRun = i;
    step(`Iteration ${i}/${maxIterations}...`);
    const progressSoFar = existsSync(progressPath)
      ? readFileSync(progressPath, "utf-8")
      : "";
    const prompt = spec.buildPrompt({
      goal,
      iteration: i,
      maxIterations,
      progressSoFar: tail(progressSoFar, 6000),
    });

    const result = spawnGrokHeadless(
      prompt,
      grokArgs,
      { ...process.env, GROK_HOME: grokHome },
      grokBin
    );

    const output = (result.stdout || result.stderr || "").trim();
    appendFileSync(
      logPath,
      JSON.stringify({
        iteration: i,
        ts: new Date().toISOString(),
        status: result.status,
        output,
      }) + "\n",
      "utf-8"
    );

    if (!result.ok && !output) {
      warn(`Iteration ${i} failed (grok exit ${result.status}). Stopping.`);
      if (result.stderr) print(dim(tail(result.stderr, 500)));
      break;
    }

    const summary = stripSentinels(output);
    appendFileSync(progressPath, `\n## Iteration ${i}\n${summary.trim()}\n`, "utf-8");

    // Show a compact view of what happened this iteration.
    print(dim(indent(tail(summary, 800))));

    if (isComplete(output)) {
      completed = true;
      ok(`Goal reported complete after ${i} iteration(s).`);
      break;
    }
    info(`Iteration ${i} done — continuing.`);
  }

  print("");
  if (completed) {
    ok(`${spec.title} finished: goal complete.`);
  } else {
    warn(`${spec.title} stopped after ${maxIterations} iteration(s) without a ${COMPLETE_SENTINEL} signal.`);
    print(dim(`Review progress: ${progressPath}`));
  }

  // Capture a durable digest so the next session recalls what this run did.
  if (options.digest !== false) {
    const digestPath = writeMemoryDigest(repoRoot, spec.kind, goal, completed, iterationsRun, progressPath);
    if (digestPath) print(dim(`Memory digest: ${digestPath}`));
  }

  print(dim(`Full log: ${logPath}`));
}

export async function runCruise(cwd: string, goal: string, options: LoopOptions = {}): Promise<void> {
  return runLoop(cwd, goal, {
    kind: "cruise",
    title: "Cruise",
    buildPrompt: buildCruisePrompt,
  }, options);
}

export async function runQuest(cwd: string, goal: string, options: LoopOptions = {}): Promise<void> {
  return runLoop(cwd, goal, {
    kind: "quest",
    title: "Quest",
    buildPrompt: buildQuestPrompt,
  }, options);
}

export async function runRalph(cwd: string, goal: string, options: LoopOptions = {}): Promise<void> {
  return runLoop(cwd, goal, {
    kind: "ralph",
    title: "Ralph",
    buildPrompt: buildRalphPrompt,
  }, options);
}

function isComplete(output: string): boolean {
  return output.includes(COMPLETE_SENTINEL) || output.includes(LEGACY_COMPLETE);
}

function tail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return "...(truncated)...\n" + text.slice(text.length - maxChars);
}

function stripSentinels(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return t !== COMPLETE_SENTINEL && t !== CONTINUE_SENTINEL && t !== LEGACY_COMPLETE;
    })
    .join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}
