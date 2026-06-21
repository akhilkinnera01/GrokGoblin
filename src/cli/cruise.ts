import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import {
  resolveGrokHome,
  DEFAULT_FAST_MODEL,
  DEFAULT_FRONTIER_MODEL,
  resolveProjectMemoryPath,
} from "../utils/paths.js";
import { isGitRepo, gitRepoRoot, spawnGrokHeadless } from "../utils/exec.js";
import { commandExists } from "../utils/exec.js";
import { resolveVerifyCommand, runCheck, workingTreeSignature, type CheckResult } from "../utils/verify.js";
import { runChecker } from "./checker.js";
import { AGENT_DEFINITIONS } from "../agents/definitions.js";
import { buildRolePrompt } from "../config/subagents.js";
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
import { leaderSocketArgs } from "../utils/leader.js";

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
  /** Explicit deterministic verification command (overrides auto-detection). */
  verify?: string;
  /** Disable the deterministic verification gate entirely. */
  noVerify?: boolean;
  /** grok --max-turns cap per iteration (bounds runaway exploration). */
  maxTurns?: number;
  /** Wall-clock budget per iteration in ms (kills a hung "stuck" iteration). */
  iterationTimeoutMs?: number;
  /**
   * Never stuck-abort: keep iterating (escalating model) until completion or the
   * iteration budget is spent. For deliberately long autonomous runs.
   */
  relentless?: boolean;
  /**
   * Optional control hook checked at the top of every iteration. Lets an outer
   * driver (e.g. `gg hunt`) pause/stop a long or detached run between iterations
   * without coupling the loop to goal storage. Return "stop" or "pause" to break.
   */
  controlCheck?: () => "continue" | "pause" | "stop";
}

/** Outcome of a loop run, so an orchestrator can record status. */
export interface LoopResult {
  completed: boolean;
  iterations: number;
  /** Set when a controlCheck asked the loop to stop/pause. */
  halted?: "pause" | "stop";
}

// Loop budgets — tuned so a stuck run recovers/aborts instead of burning tokens.
const DEFAULT_MAX_TURNS = 40;
const DEFAULT_ITERATION_TIMEOUT_MS = 20 * 60 * 1000; // 20 min
const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60 * 1000; // 10 min for the verify command
// Consecutive no-progress iterations before we escalate the maker model; one more
// stale round after escalation aborts the run (state is preserved for resume).
const STUCK_ROUNDS_BEFORE_ESCALATE = 2;

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

// Append one structured iteration record to the run log. `phase` is the maker's
// stated intent (CLAIM/CONT/TIMEOUT) and `checkOk` is the harness verdict (null
// when no check ran), so the log alone explains why the loop did what it did.
function appendLog(
  logPath: string,
  iteration: number,
  model: string,
  status: number,
  phase: string,
  checkOk: boolean | null
): void {
  appendFileSync(
    logPath,
    JSON.stringify({
      iteration,
      ts: new Date().toISOString(),
      model,
      status,
      phase,
      checkOk,
    }) + "\n",
    "utf-8"
  );
}

// Back-compat alias for the previous public name.
export type CruiseOptions = LoopOptions;

interface LoopSpec {
  /** Display + state-dir label, e.g. "cruise" | "quest" | "ralph" | "goblins". */
  kind: string;
  /** Human title for the header banner. */
  title: string;
  /** Builds the per-iteration prompt. */
  buildPrompt: (ctx: PromptCtx) => string;
  /** Extra grok args appended every iteration (e.g. --agents roster for goblins). */
  extraArgs?: string[];
}

interface PromptCtx {
  goal: string;
  iteration: number;
  maxIterations: number;
  progressSoFar: string;
  /** The deterministic command the harness will run to judge completion, if any. */
  verifyCommand?: string | null;
  /** Failure output from the last verification run, fed back for a targeted fix. */
  verifyFeedback?: string;
}

// Reusable verification gate appended to every loop prompt so "verify before
// done" just happens by default — never claim completion on unverified code.
// The harness ALSO runs the deterministic check itself after each iteration, so
// the sentinel alone never ends the loop — it must coincide with a green check.
function verificationGate(ctx?: PromptCtx): string[] {
  const lines: string[] = ["## Verification gate (mandatory before completing)"];
  if (ctx?.verifyCommand) {
    lines.push(
      `- After this iteration, the harness will run \`${ctx.verifyCommand}\` itself. Completion is only accepted when that command PASSES — you cannot self-certify past it.`,
      `- Before claiming completion, RUN \`${ctx.verifyCommand}\` yourself and make it pass.`
    );
  } else {
    lines.push(
      `- After this iteration, an independent QC reviewer agent will inspect your work against the goal. Completion is only accepted if it passes review.`,
      "- If a build/test command exists, run it and make it pass before claiming completion.",
      "- Otherwise state explicitly, with concrete evidence, how the goal is verifiably met."
    );
  }
  if (ctx?.verifyFeedback && ctx.verifyFeedback.trim()) {
    lines.push(
      "",
      "## Last verification FAILED — fix this first",
      "```",
      tail(ctx.verifyFeedback.trim(), 1500),
      "```"
    );
  }
  lines.push(
    "",
    "## Required final line",
    "End your response with EXACTLY one of these on its own line:",
    `- \`${COMPLETE_SENTINEL}\` — goal fully achieved AND verified.`,
    `- \`${CONTINUE_SENTINEL}\` — more work remains for the next iteration.`
  );
  return lines;
}

function buildCruisePrompt(ctx: PromptCtx): string {
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
    ...verificationGate(ctx),
  ].join("\n");
}

function buildQuestPrompt(ctx: PromptCtx): string {
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
    ...verificationGate(ctx),
  ].join("\n");
}

function buildRalphPrompt(ctx: PromptCtx): string {
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
    ...verificationGate(ctx),
  ].join("\n");
}

async function runLoop(
  cwd: string,
  goal: string,
  spec: LoopSpec,
  options: LoopOptions = {}
): Promise<LoopResult> {
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

  // Coerce to a sane positive integer — a bad `--max-iterations foo` (NaN) must
  // fall back to the default, not silently run zero iterations.
  const maxIterations =
    Number.isFinite(options.maxIterations) && (options.maxIterations as number) > 0
      ? Math.floor(options.maxIterations as number)
      : DEFAULT_MAX_ITERATIONS;
  const bestOf =
    Number.isFinite(options.bestOf) && (options.bestOf as number) > 1
      ? Math.floor(options.bestOf as number)
      : undefined;
  // Model tiering: an explicit --model (or --fast) pins the model and disables
  // escalation. Otherwise the loop is cost-tiered — it starts on the cheap/fast
  // model and only escalates to the frontier model when it gets stuck, which is
  // the main token win over running every iteration on the frontier model.
  const pinnedModel = options.model ?? (options.fast ? DEFAULT_FAST_MODEL : undefined);
  const tieringEnabled = !pinnedModel;
  let currentModel = pinnedModel ?? DEFAULT_FAST_MODEL;

  const maxTurns =
    Number.isFinite(options.maxTurns) && (options.maxTurns as number) > 0
      ? Math.floor(options.maxTurns as number)
      : DEFAULT_MAX_TURNS;
  const iterationTimeoutMs =
    Number.isFinite(options.iterationTimeoutMs) && (options.iterationTimeoutMs as number) > 0
      ? Math.floor(options.iterationTimeoutMs as number)
      : DEFAULT_ITERATION_TIMEOUT_MS;

  const repoRoot = gitRepoRoot(cwd) ?? cwd;
  // Deterministic verification gate (ground truth). null => fall back to an
  // independent QC reviewer agent when the maker claims completion.
  const verifyCommand = resolveVerifyCommand(repoRoot, options.verify, Boolean(options.noVerify));
  const runId = `${Date.now()}`;
  const runDir = join(repoRoot, ".grokgoblin", spec.kind, runId);
  mkdirSync(runDir, { recursive: true });
  const logPath = join(runDir, "log.jsonl");
  const progressPath = join(runDir, "progress.md");
  writeFileSync(join(runDir, "goal.md"), `# ${spec.title} goal\n\n${goal}\n`, "utf-8");
  writeFileSync(progressPath, "", "utf-8");

  header(`GrokGoblin ${spec.title}`);
  print(`${dim("goal:")}   ${goal}`);
  print(
    `${dim("model:")}  ${
      pinnedModel
        ? pinnedModel
        : `${currentModel} → ${DEFAULT_FRONTIER_MODEL} on stall (tiered)`
    }`
  );
  print(`${dim("verify:")} ${verifyCommand ?? "independent QC reviewer (no test command found)"}`);
  print(`${dim("max:")}    ${maxIterations} iterations · ${maxTurns} turns/iter`);
  print(`${dim("state:")}  ${runDir}`);
  print("");

  const baseGrokArgs = ["--always-approve", "--experimental-memory", "--output-format", "plain"];
  // segments compaction persists compacted history as grep-able markdown, so a
  // long iteration can recover earlier detail instead of losing it to the window.
  baseGrokArgs.push("--compaction-mode", "segments");
  // Bound each iteration's agent turns so a confused run can't explore forever.
  baseGrokArgs.push("--max-turns", String(maxTurns));
  // Isolate the leader per MCP-config fingerprint so loop iterations honor the
  // current MCP servers instead of a stale leader's cached connections.
  baseGrokArgs.push(...leaderSocketArgs(grokHome, cwd));
  // --best-of-n runs the turn N ways in parallel and keeps the best (headless only).
  if (bestOf) {
    baseGrokArgs.push("--best-of-n", String(bestOf));
  }

  // Regression oracle baseline: snapshot whether the check passes BEFORE any work.
  // A task that starts red just needs to go green; a task that starts green must
  // not be allowed to regress to red while the agent claims "done".
  let baselineGreen = false;
  if (verifyCommand) {
    step(`Baseline check: ${verifyCommand}`);
    const baseline = runCheck(verifyCommand, repoRoot, DEFAULT_CHECK_TIMEOUT_MS);
    baselineGreen = baseline.ok;
    print(dim(baselineGreen ? "  baseline: passing (must stay green)" : "  baseline: failing (target: make it pass)"));
  }

  let completed = false;
  let iterationsRun = 0;
  let verifyFeedback = "";
  let stuckRounds = 0;
  let escalated = false;
  let prevSignature = "";
  // For the QC-reviewer (no deterministic check) path: remember the working-tree
  // fingerprint + last verdict so we can skip a paid re-review when the maker
  // changed nothing this round.
  let lastTreeSig = "";
  let lastReviewSig = "";
  let halted: "pause" | "stop" | undefined;

  for (let i = 1; i <= maxIterations; i++) {
    // Honor an external pause/stop request (e.g. `gg hunt pause`) at the safe
    // boundary between iterations before spending another grok call.
    const control = options.controlCheck?.() ?? "continue";
    if (control !== "continue") {
      halted = control;
      warn(`Loop ${control === "pause" ? "paused" : "stopped"} by request after ${iterationsRun} iteration(s).`);
      break;
    }
    iterationsRun = i;
    step(`Iteration ${i}/${maxIterations} (${currentModel})...`);
    const progressSoFar = existsSync(progressPath)
      ? readFileSync(progressPath, "utf-8")
      : "";
    const prompt = spec.buildPrompt({
      goal,
      iteration: i,
      maxIterations,
      // Lean context: after the first round, re-send only a short progress tail
      // (not the whole transcript) so per-iteration cost doesn't grow O(N²).
      progressSoFar: tail(progressSoFar, i === 1 ? 4000 : 2000),
      verifyCommand,
      verifyFeedback,
    });

    const grokArgs = ["-m", currentModel, ...baseGrokArgs, ...(spec.extraArgs ?? [])];
    const result = spawnGrokHeadless(
      prompt,
      grokArgs,
      { ...process.env, GROK_HOME: grokHome },
      grokBin,
      iterationTimeoutMs
    );

    const output = (result.stdout || result.stderr || "").trim();

    // A hung iteration (wall-clock timeout) is the "agent got stuck" failure —
    // recover by escalating/aborting instead of blocking the loop forever.
    if (result.timedOut) {
      warn(`Iteration ${i} hit the ${Math.round(iterationTimeoutMs / 60000)}m time budget and was stopped.`);
      appendLog(logPath, i, currentModel, result.status, "TIMEOUT", null);
      const action = stallAction();
      if (action === "abort") break;
      continue;
    }

    if (!result.ok && !output) {
      warn(`Iteration ${i} failed (grok exit ${result.status}). Stopping.`);
      if (result.stderr) print(dim(tail(result.stderr, 500)));
      break;
    }

    const summary = stripSentinels(output);
    appendFileSync(progressPath, `\n## Iteration ${i}\n${summary.trim()}\n`, "utf-8");
    print(dim(indent(tail(summary, 800))));

    const modelClaimsComplete = isComplete(output);

    // ── Verification gate ────────────────────────────────────────────────
    // Deterministic check is the primary gate (ground truth, ~0 model tokens).
    // When no check exists, an independent QC reviewer is consulted ONLY when the
    // maker claims completion (so we never pay for review on every iteration).
    let verified = false;
    let checkSignature = summary.slice(-400);
    if (verifyCommand) {
      const check: CheckResult = runCheck(verifyCommand, repoRoot, DEFAULT_CHECK_TIMEOUT_MS);
      checkSignature = `${check.ok}:${check.output.slice(-400)}`;
      if (check.ok) {
        ok(`  check passed: ${verifyCommand}`);
        verifyFeedback = "";
        verified = modelClaimsComplete;
        if (!modelClaimsComplete) {
          info("  check is green but more sub-goals remain — continuing.");
        }
      } else {
        warn(`  check failed: ${verifyCommand}`);
        verifyFeedback = check.output;
        verified = false;
      }
      appendLog(logPath, i, currentModel, result.status, modelClaimsComplete ? "CLAIM" : "CONT", check.ok);
    } else {
      // No deterministic check — the independent QC reviewer IS the gate. Run it
      // every iteration rather than gating on the model remembering to print the
      // sentinel: small models routinely finish non-testable work (e.g. a data
      // extraction or a written artifact) without emitting GG-COMPLETE, and that
      // good work must not be discarded.
      // Token saver: if the maker changed nothing this round, re-reviewing would
      // just reproduce the prior (failing) verdict — skip the paid QC call.
      const treeSig = workingTreeSignature(repoRoot);
      if (treeSig && treeSig === lastTreeSig && lastReviewSig) {
        info("  no file changes this iteration — skipping QC re-review.");
        checkSignature = lastReviewSig;
        verified = false;
        appendLog(logPath, i, currentModel, result.status, "NOCHG", false);
      } else {
        step("  running independent QC reviewer...");
        const review = runChecker(goal, repoRoot, grokHome, grokBin, leaderSocketArgs(grokHome, cwd));
        checkSignature = `${review.pass}:${review.feedback.slice(-400)}`;
        lastTreeSig = treeSig;
        lastReviewSig = checkSignature;
        if (review.pass) {
          ok("  QC reviewer: PASS");
          verified = true;
          verifyFeedback = "";
        } else {
          warn("  QC reviewer: FAIL");
          verifyFeedback = review.feedback;
          verified = false;
        }
        appendLog(logPath, i, currentModel, result.status, modelClaimsComplete ? "CLAIM" : "CONT", review.pass);
      }
    }

    if (verified) {
      completed = true;
      ok(`Goal complete and verified after ${i} iteration(s).`);
      break;
    }

    // ── Stuck detection ──────────────────────────────────────────────────
    // No change in the verification signature across rounds => not progressing.
    if (checkSignature === prevSignature) {
      stuckRounds++;
    } else {
      stuckRounds = 0;
      prevSignature = checkSignature;
    }
    if (stuckRounds >= STUCK_ROUNDS_BEFORE_ESCALATE) {
      if (stallAction() === "abort") break;
    } else {
      info(`Iteration ${i} done — continuing.`);
    }
  }

  // Escalate the maker model on stall, or abort if already escalated. Returns
  // "abort" when the loop should stop (state is preserved on disk for resume).
  function stallAction(): "escalate" | "abort" {
    if (tieringEnabled && !escalated && currentModel !== DEFAULT_FRONTIER_MODEL) {
      currentModel = DEFAULT_FRONTIER_MODEL;
      escalated = true;
      stuckRounds = 0;
      warn(`No progress — escalating maker to ${DEFAULT_FRONTIER_MODEL}.`);
      return "escalate";
    }
    // Relentless mode: never give up early — keep grinding until completion or the
    // iteration budget is spent (Codex /goal "run until correct" behavior). The
    // budget caps total spend, so this is bounded, just not stuck-aborted.
    if (options.relentless) {
      stuckRounds = 0;
      warn("No progress — relentless mode, continuing until the iteration budget.");
      return "escalate";
    }
    warn("No progress after escalation — stopping to avoid burning tokens.");
    print(dim(`Resume from saved state: ${runDir}`));
    return "abort";
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
  return { completed, iterations: iterationsRun, halted };
}

export async function runCruise(cwd: string, goal: string, options: LoopOptions = {}): Promise<LoopResult> {
  return runLoop(cwd, goal, {
    kind: "cruise",
    title: "Cruise",
    buildPrompt: buildCruisePrompt,
  }, options);
}

export async function runQuest(cwd: string, goal: string, options: LoopOptions = {}): Promise<LoopResult> {
  return runLoop(cwd, goal, {
    kind: "quest",
    title: "Quest",
    buildPrompt: buildQuestPrompt,
  }, options);
}

export async function runRalph(cwd: string, goal: string, options: LoopOptions = {}): Promise<LoopResult> {
  return runLoop(cwd, goal, {
    kind: "ralph",
    title: "Ralph",
    buildPrompt: buildRalphPrompt,
  }, options);
}

// Verified Goblins loop: the multi-agent mode, run through the SAME verification
// gate / budgets / model-tiering / stuck-detection as cruise. Each iteration the
// leader fans the work out to specialist goblins (registered via --agents), then
// the harness — not the leader — decides completion via the deterministic check
// (or an independent QC reviewer when there is none). That's what makes Goblins
// "run until correct" instead of fire-and-forget.
function buildGoblinsPrompt(
  ctx: PromptCtx,
  workerCount: number,
  roleNames: string[],
  preferredRole: string
): string {
  return [
    "You are the LEAD GOBLIN orchestrating a multi-goblin effort inside `gg goblins` —",
    "a headless loop that re-invokes you each iteration until the work is verifiably correct.",
    `Iteration ${ctx.iteration} of at most ${ctx.maxIterations}.`,
    "",
    "## Goal",
    ctx.goal,
    "",
    "## How to work this iteration",
    `- Decompose the remaining work into UP TO ${workerCount} independent specialist passes, each playing one of the goblin roles: ${roleNames.join(", ")}.`,
    preferredRole ? `- Bias toward the \`${preferredRole}\` role.` : "",
    "- PREFER spawning them as parallel subagents via `spawn_subagent` (alias `task`) if it is invocable; if not, run the passes yourself IN PARALLEL (parallel tool calls / background commands) — never stall on an unavailable tool.",
    "- Each pass must have a clear, self-contained scope. Then integrate the passes and resolve conflicts.",
    "",
    "## Progress so far (from previous iterations)",
    ctx.progressSoFar.trim() || "(none yet — this is the first iteration)",
    "",
    "## Instructions",
    "- Make concrete, integrated progress this iteration; do not re-do completed work.",
    "- Recall prior decisions from memory (memory_search) before changing direction.",
    "",
    ...verificationGate(ctx),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runGoblinsVerified(
  cwd: string,
  task: string,
  workerCount: number,
  preferredRole: string,
  options: LoopOptions = {}
): Promise<LoopResult> {
  const roleNames = Object.keys(AGENT_DEFINITIONS);
  // The roster is what makes spawn_subagent available to the leader; even when
  // the spawned worker is unreliable headless, the leader still falls back to
  // parallel self-work, and the harness gate is what guarantees correctness.
  const agentsMap: Record<string, { description: string; prompt: string; model: string }> = {};
  for (const [name, def] of Object.entries(AGENT_DEFINITIONS)) {
    agentsMap[name] = {
      description: def.description,
      prompt: buildRolePrompt(name, def),
      model: def.model,
    };
  }

  return runLoop(cwd, task, {
    kind: "goblins",
    title: "Goblins",
    buildPrompt: (ctx) => buildGoblinsPrompt(ctx, workerCount, roleNames, preferredRole),
    extraArgs: ["--agents", JSON.stringify(agentsMap)],
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
