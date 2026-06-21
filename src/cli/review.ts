import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  gitRepoRoot,
  isGitRepo,
  runSync,
  commandExists,
  spawnGrokHeadlessAsync,
} from "../utils/exec.js";
import { resolveGrokHome, DEFAULT_FRONTIER_MODEL } from "../utils/paths.js";
import { leaderSocketArgs } from "../utils/leader.js";
import { print, header, ok, warn, info, step, dim, bold, exitWithError } from "../utils/print.js";

// `gg review` — independent, severity-rated code review for grok.
// Two INDEPENDENT review lanes run in parallel as separate grok processes (never
// self-review; native spawn_subagent is unreliable headless), high-signal severity
// rating (CRITICAL/HIGH/MEDIUM/LOW), file:line findings, repo AGENTS.md review
// guidelines honored, and a DETERMINISTIC verdict synthesis. If a lane can't run,
// the review is "unavailable" and blocks — it never falls back to approving.

const MAX_DIFF_BYTES = 60_000;
const LANE_TIMEOUT_MS = 8 * 60 * 1000;
const LANE_MAX_TURNS = 14;

type Inspector = "APPROVE" | "REQUEST_CHANGES" | "COMMENT" | null;
type Warden = "CLEAR" | "WATCH" | "BLOCK" | null;
type Verdict = "APPROVE" | "COMMENT" | "REQUEST_CHANGES" | "UNAVAILABLE";

interface ReviewTarget {
  label: string;
  diff: string;
  pr?: string; // PR number/url when reviewing a GitHub PR
}

// Resolve what to review: a GitHub PR (number/url), staged changes, a commit
// range, or (default) the working tree against HEAD.
function resolveTarget(
  repoRoot: string,
  arg: string | undefined,
  staged: boolean
): ReviewTarget | null {
  if (arg && /^\d+$/.test(arg)) {
    if (!commandExists("gh")) exitWithError("Reviewing a PR needs the GitHub CLI (gh). Install it or review a local diff.");
    const d = runSync("gh", ["pr", "diff", arg], { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
    if (!d.ok) exitWithError(`Could not fetch PR #${arg}: ${d.stderr || d.stdout}`);
    return { label: `PR #${arg}`, diff: d.stdout, pr: arg };
  }
  if (staged) {
    const d = runSync("git", ["diff", "--cached"], { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
    return { label: "staged changes", diff: d.stdout };
  }
  if (arg && arg.includes("..")) {
    const d = runSync("git", ["diff", arg], { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
    return { label: arg, diff: d.stdout };
  }
  // Fresh repo with no commits yet: review all files (intent-to-add so new files
  // show up in the diff). Without this, `git diff HEAD` fails and a user trying to
  // review their first files gets nothing.
  if (!runSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: repoRoot }).ok) {
    runSync("git", ["add", "-A", "-N"], { cwd: repoRoot });
    const d = runSync("git", ["diff"], { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
    return { label: "all files (new repo)", diff: d.stdout };
  }
  // Default: everything not yet committed (working tree + staged) vs HEAD.
  const d = runSync("git", ["diff", "HEAD"], { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
  return { label: "working tree vs HEAD", diff: d.stdout };
}

// Pull any Review guidelines the repo declares (nearest AGENTS.md at the root).
function repoReviewGuidelines(repoRoot: string): string {
  for (const name of ["AGENTS.md", "CLAUDE.md", ".grok/AGENTS.md"]) {
    const p = join(repoRoot, name);
    if (existsSync(p)) {
      try {
        return readFileSync(p, "utf-8").slice(0, 4000);
      } catch {
        /* ignore */
      }
    }
  }
  return "";
}

function inspectorPrompt(diff: string, guidelines: string): string {
  return [
    "You are the NITPICKER — an independent, senior code reviewer. You did NOT write this code.",
    "Review ONLY the diff below. Be rigorous but HIGH-SIGNAL: lead with the issues that matter.",
    "",
    guidelines ? `## Repo review guidelines (follow these)\n${guidelines}\n` : "",
    "## Review categories",
    "Correctness/bugs, security, performance, code quality, maintainability, test coverage.",
    "",
    "## For each finding",
    "- Severity: CRITICAL (must fix / security or data loss), HIGH (bug or major smell), MEDIUM (should fix), LOW (style/nit).",
    "- Location: file:line from the diff.",
    "- A concrete fix (code snippet where useful).",
    "Lead with CRITICAL and HIGH. Do not pad with LOW noise — omit trivia.",
    "",
    "## Required final line",
    "End with EXACTLY one: `INSPECTOR: REQUEST_CHANGES` (any CRITICAL/HIGH) | `INSPECTOR: COMMENT` (only MEDIUM/LOW) | `INSPECTOR: APPROVE` (clean).",
    "",
    "## Diff",
    "```diff",
    diff,
    "```",
  ]
    .filter(Boolean)
    .join("\n");
}

function wardenPrompt(diff: string, guidelines: string): string {
  return [
    "You are the WARDEN — a skeptical principal architect doing a DEVIL'S-ADVOCATE review of the diff.",
    "You are NOT looking for line nits (the Nitpicker covers those). You hunt design-level risk:",
    "regressions, broken invariants/contracts, missed edge cases, hidden coupling, concurrency/ordering",
    "hazards, backwards-incompatibility, and 'looks right but is subtly wrong' logic.",
    "",
    guidelines ? `## Repo guidelines\n${guidelines}\n` : "",
    "## Required final line",
    "End with EXACTLY one: `WARDEN: BLOCK` (a real design blocker; explain it) | `WARDEN: WATCH` (non-blocking concern to surface) | `WARDEN: CLEAR` (no architectural blocker).",
    "",
    "## Diff",
    "```diff",
    diff,
    "```",
  ]
    .filter(Boolean)
    .join("\n");
}

// Find the lane's verdict: scan bottom-up for the line carrying the prefix, then
// return whichever known token it contains. Tolerant of markdown decoration
// (e.g. `**INSPECTOR: REQUEST_CHANGES**` or backtick-wrapped tokens).
function laneVerdict<T extends string>(out: string, prefix: string, tokens: readonly T[]): T | null {
  if (!out) return null;
  const lines = out.split("\n").map((l) => l.trim().toUpperCase()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(prefix)) {
      for (const t of tokens) if (lines[i].includes(t)) return t;
    }
  }
  return null;
}

// Deterministic merge gating: a Warden BLOCK or Inspector REQUEST_CHANGES forces
// REQUEST_CHANGES; a WATCH downgrades an approval to COMMENT; clean is APPROVE.
function synthesize(inspector: Inspector, warden: Warden): Verdict {
  if (inspector === null || warden === null) return "UNAVAILABLE";
  if (warden === "BLOCK" || inspector === "REQUEST_CHANGES") return "REQUEST_CHANGES";
  if (warden === "WATCH" || inspector === "COMMENT") return "COMMENT";
  return "APPROVE";
}

export async function runReview(
  cwd: string,
  args: string[],
  flags: Record<string, string | boolean | number>
): Promise<void> {
  const grokBin = process.env["GROK_BIN"] ?? "grok";
  if (!commandExists(grokBin)) exitWithError("grok not found on PATH. Run `gg setup` first.");
  if (!isGitRepo(cwd)) exitWithError("gg review needs a git repository.");
  const repoRoot = gitRepoRoot(cwd) ?? cwd;
  const grokHome = resolveGrokHome();
  const leaderArgs = leaderSocketArgs(grokHome, repoRoot);

  const target = resolveTarget(repoRoot, args[0], Boolean(flags["staged"]));
  if (!target || !target.diff.trim()) {
    warn("Nothing to review (empty diff).");
    return;
  }
  let diff = target.diff;
  let truncated = false;
  if (Buffer.byteLength(diff) > MAX_DIFF_BYTES) {
    diff = diff.slice(0, MAX_DIFF_BYTES);
    truncated = true;
  }
  const guidelines = repoReviewGuidelines(repoRoot);

  header("GrokGoblin review");
  print(`${dim("target:")} ${target.label}${truncated ? dim(" (diff truncated to 60KB)") : ""}`);
  print(`${dim("lanes:")}  nitpicker + warden (independent, parallel)`);
  if (guidelines) print(dim("        following repo review guidelines"));
  print("");
  step("Running two independent review lanes...");
  print(dim("  (two frontier reviewers in parallel — typically 1–3 min; sit tight)"));

  const baseArgs = [
    "-m", DEFAULT_FRONTIER_MODEL,
    "--always-approve",
    "--max-turns", String(LANE_MAX_TURNS),
    "--output-format", "plain",
    ...leaderArgs,
  ];
  const env = { ...process.env, GROK_HOME: grokHome };
  const [insp, ward] = await Promise.all([
    spawnGrokHeadlessAsync(inspectorPrompt(diff, guidelines), baseArgs, { env, grokBin, cwd: repoRoot, timeoutMs: LANE_TIMEOUT_MS }),
    spawnGrokHeadlessAsync(wardenPrompt(diff, guidelines), baseArgs, { env, grokBin, cwd: repoRoot, timeoutMs: LANE_TIMEOUT_MS }),
  ]);

  const inspOut = (insp.stdout || "").trim();
  const wardOut = (ward.stdout || "").trim();
  // Fail-closed: a lane that timed out / returned nothing makes the review
  // UNAVAILABLE — never silently approve on a missing independent lane.
  const inspV: Inspector = insp.timedOut || !inspOut ? null : laneVerdict(inspOut, "INSPECTOR:", ["REQUEST_CHANGES", "COMMENT", "APPROVE"] as const);
  const wardV: Warden = ward.timedOut || !wardOut ? null : laneVerdict(wardOut, "WARDEN:", ["BLOCK", "WATCH", "CLEAR"] as const);
  const verdict = synthesize(inspV, wardV);

  print("");
  print(bold("── Nitpicker (correctness / security / quality) ──"));
  print(inspOut ? stripFinal(inspOut, "INSPECTOR:") : dim("  (no output — lane unavailable)"));
  print("");
  print(bold("── Warden (design / regressions / edge cases) ──"));
  print(wardOut ? stripFinal(wardOut, "WARDEN:") : dim("  (no output — lane unavailable)"));
  print("");

  const banner =
    verdict === "APPROVE" ? ok :
    verdict === "UNAVAILABLE" ? warn :
    verdict === "REQUEST_CHANGES" ? warn : info;
  banner(`VERDICT: ${verdict}  ${dim(`(nitpicker=${inspV ?? "unavailable"}, warden=${wardV ?? "unavailable"})`)}`);
  if (verdict === "UNAVAILABLE") {
    warn("Independent review could not complete — NOT approving. Re-run or check grok auth.");
  }

  // Optional: post the verdict to the GitHub PR (outward-facing → opt-in only).
  if (target.pr && flags["post"]) {
    postToPr(repoRoot, target.pr, verdict, inspOut, wardOut);
  } else if (target.pr) {
    print(dim("(add --post to publish this review to the PR)"));
  }
}

// Strip the final machine verdict line from a lane's human-readable body.
function stripFinal(out: string, prefix: string): string {
  return out
    .split("\n")
    .filter((l) => !l.trim().replace(/^[*_`#>\s-]+/, "").toUpperCase().startsWith(prefix))
    .join("\n")
    .trim();
}

function postToPr(repoRoot: string, pr: string, verdict: Verdict, insp: string, ward: string): void {
  if (!commandExists("gh")) {
    warn("gh not found — cannot post the review.");
    return;
  }
  const body = [
    `## GrokGoblin review — ${verdict}`,
    "",
    "### Nitpicker (correctness / security / quality)",
    insp || "_unavailable_",
    "",
    "### Warden (design / regressions)",
    ward || "_unavailable_",
  ].join("\n");
  const flag = verdict === "REQUEST_CHANGES" ? "--request-changes" : verdict === "APPROVE" ? "--approve" : "--comment";
  const r = runSync("gh", ["pr", "review", pr, flag, "--body", body], { cwd: repoRoot });
  if (r.ok) ok(`Posted review to PR #${pr}.`);
  else warn(`Failed to post review: ${r.stderr || r.stdout}`);
}
