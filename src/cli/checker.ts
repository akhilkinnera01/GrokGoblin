import { spawnGrokHeadless } from "../utils/exec.js";
import { DEFAULT_FRONTIER_MODEL } from "../utils/paths.js";

// The independent QC reviewer. Used ONLY when a task has no deterministic check
// (e.g. data extraction / document summarisation like the investing-journal
// task). It runs as a SEPARATE grok process — not a spawn_subagent, which dies on
// auth headless on grok 0.2.59 — so the harness, not the maker, owns the verdict.
// This is the answer to "you're just grading vibes twice": the reviewer did NOT
// do the work, runs on the frontier model, and grades against a goal-derived
// rubric while cross-checking claims against the actual files.

export interface CheckerVerdict {
  pass: boolean;
  feedback: string;
}

const QC_PASS = "QC-PASS";
const QC_FAIL = "QC-FAIL";
const QC_MAX_TURNS = 12;
const QC_TIMEOUT_MS = 8 * 60 * 1000;

function buildCheckerPrompt(goal: string): string {
  return [
    "You are an INDEPENDENT QC reviewer. You did NOT do this work — your only job is to",
    "verify it rigorously and skeptically. Do not fix anything; only judge.",
    "",
    "## The goal the work was supposed to achieve",
    goal,
    "",
    "## How to review",
    "1. Derive an explicit checklist of concrete acceptance criteria from the goal above.",
    "2. Inspect the actual repository/output (read files, run read-only commands) to confirm EACH criterion.",
    "3. Cross-check claims against ground truth — e.g. that recorded values actually appear in the source files, that counts match, that nothing was fabricated or skipped.",
    "4. Look for the common failure: output that looks plausible but is incomplete, mislabeled, or inconsistent with the sources.",
    "",
    "## Verdict (required)",
    "End your response with EXACTLY one of these on its own final line:",
    `- \`${QC_PASS}\` — every criterion is met and verified against the actual files.`,
    `- \`${QC_FAIL}: <the specific, actionable gaps>\` — anything is missing, wrong, unverified, or inconsistent.`,
    "When in doubt, FAIL with concrete reasons. Do not pass on vibes.",
  ].join("\n");
}

export function runChecker(
  goal: string,
  repoRoot: string,
  grokHome: string,
  grokBin: string,
  leaderArgs: string[]
): CheckerVerdict {
  const args = [
    "-m",
    DEFAULT_FRONTIER_MODEL,
    "--always-approve",
    "--max-turns",
    String(QC_MAX_TURNS),
    "--output-format",
    "plain",
    ...leaderArgs,
  ];
  const result = spawnGrokHeadless(
    buildCheckerPrompt(goal),
    args,
    { ...process.env, GROK_HOME: grokHome },
    grokBin,
    QC_TIMEOUT_MS
  );
  const out = (result.stdout || result.stderr || "").trim();

  // A reviewer that didn't actually return a verdict (timeout, crash) must NOT be
  // read as a pass — fail closed so completion is never accepted on a missing review.
  if (result.timedOut || !out) {
    return { pass: false, feedback: "QC reviewer did not return a verdict (timeout/empty) — treating as not verified." };
  }
  // PASS only on an explicit QC-PASS that is not part of a QC-FAIL line.
  const hasFail = new RegExp(`${QC_FAIL}`).test(out);
  const hasPass = new RegExp(`(^|\\n)\\s*${QC_PASS}\\b`).test(out);
  if (hasPass && !hasFail) {
    return { pass: true, feedback: "" };
  }
  // Surface the reviewer's stated reasons (tail of the response) as feedback.
  return { pass: false, feedback: out.slice(-1500) };
}
