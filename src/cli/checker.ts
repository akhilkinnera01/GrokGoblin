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
    "## What to judge — and what to IGNORE",
    "- Judge ONLY whether the actual deliverable for the goal is correct, as it exists in the working tree right now.",
    "- A correct file that EXISTS ON DISK satisfies the goal. Do NOT require it to be committed to git; 'untracked' / not-in-index is NOT a defect.",
    "- IGNORE all harness and process metadata — it is NOT part of the goal and must never affect your verdict: the `.grokgoblin/` directory (logs, log.jsonl, progress.md, project.md, memory), `.serena/`, `.git/`, and any record of prior runs, iterations, statuses, or 'stopped/failed' notes. Those describe the tool, not the deliverable.",
    "- Do not penalize the work for how/when it was produced. Only the end artifact matters.",
    "",
    "## How to review",
    "1. Derive an explicit checklist of concrete acceptance criteria from the goal above.",
    "2. Inspect the actual deliverable file(s) to confirm EACH criterion against their real contents.",
    "3. Cross-check claims against ground truth — e.g. that recorded values actually appear in the source files, that counts match, that nothing was fabricated or skipped.",
    "4. Look for the real failure mode: a deliverable that looks plausible but is incomplete, mislabeled, or inconsistent with its sources.",
    "",
    "## Verdict (required)",
    "End your response with EXACTLY one of these on its own final line:",
    `- \`${QC_PASS}\` — the deliverable meets every criterion, verified against the actual file contents.`,
    `- \`${QC_FAIL}: <the specific, actionable gaps>\` — the deliverable itself is missing, wrong, unverified, or inconsistent (NOT process/metadata reasons).`,
    "When in doubt about the DELIVERABLE, FAIL with concrete reasons. Do not pass on vibes; do not fail on process.",
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
  // The verdict is the FINAL verdict line, not any mention of the tokens — the
  // reviewer routinely discusses "QC-FAIL" while ultimately passing (and echoes
  // the required-format line). Scan from the bottom for the first line that, once
  // markdown decoration is stripped, starts with a verdict token.
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const bare = lines[i].replace(/^[*_`#>\s-]+/, "").toUpperCase();
    if (bare.startsWith(QC_PASS)) return { pass: true, feedback: "" };
    if (bare.startsWith(QC_FAIL)) return { pass: false, feedback: out.slice(-1500) };
  }
  // No explicit verdict line found — fail closed and surface the response.
  return { pass: false, feedback: out.slice(-1500) };
}
