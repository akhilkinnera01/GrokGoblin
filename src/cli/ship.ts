import {
  gitRepoRoot,
  isGitRepo,
  runSync,
  commandExists,
  spawnGrokHeadless,
} from "../utils/exec.js";
import { resolveVerifyCommand, runCheck } from "../utils/verify.js";
import { resolveGrokHome, DEFAULT_FAST_MODEL } from "../utils/paths.js";
import { print, header, ok, warn, info, step, dim, bold, exitWithError } from "../utils/print.js";

// `gg ship` — turn verified working changes into clean commits and (opt-in) a PR.
// Top-tier principles (2026): never ship red work (run the verification gate
// first and carry the evidence), match the repo's commit style, split into atomic
// commits by concern, stay safe (branch off the default branch, never --force,
// never auto-push), and put the verification evidence in the PR body. Outward-
// facing steps (push, open PR) happen only with explicit flags.

const COMMIT_TIMEOUT_MS = 3 * 60 * 1000;

function gitOut(repoRoot: string, args: string[]): string {
  return runSync("git", args, { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 }).stdout;
}

function defaultBranch(repoRoot: string): string {
  const r = runSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: repoRoot });
  if (r.ok && r.stdout) return r.stdout.split("/").pop()!.trim();
  // Fall back to whichever of main/master exists.
  for (const b of ["main", "master"]) {
    if (runSync("git", ["rev-parse", "--verify", b], { cwd: repoRoot }).ok) return b;
  }
  return "main";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "work";
}

// Generate a commit message that matches the repo's existing style (detected from
// recent history) for the given diff.
function generateCommitMessage(repoRoot: string, diff: string, grokHome: string, grokBin: string): string {
  const styleSamples = gitOut(repoRoot, ["log", "-30", "--pretty=format:%s"]);
  const prompt = [
    "Write ONE git commit message for the diff below.",
    "Match the repository's existing commit style exactly (tense, casing, and whether it uses",
    "conventional prefixes like feat:/fix:). Infer the style from these recent subjects:",
    styleSamples || "(no history yet — use a concise imperative subject)",
    "",
    "Output ONLY the commit message (a subject line, optionally a blank line then a short body).",
    "No code fences, no preamble.",
    "",
    "## Diff",
    diff.slice(0, 40_000),
  ].join("\n");
  const r = spawnGrokHeadless(
    prompt,
    ["-m", DEFAULT_FAST_MODEL, "--always-approve", "--output-format", "plain"],
    { ...process.env, GROK_HOME: grokHome },
    grokBin,
    COMMIT_TIMEOUT_MS
  );
  const msg = (r.stdout || "").trim().replace(/^```[a-z]*\n?|```$/g, "").trim();
  return msg || "Update";
}

// Files with pending changes (modified, added, untracked, renamed-target).
function changedFiles(repoRoot: string): string[] {
  const out = gitOut(repoRoot, ["status", "--porcelain"]);
  const files: string[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    let p = line.slice(3).trim();
    if (p.includes(" -> ")) p = p.split(" -> ")[1]!.trim(); // rename target
    p = p.replace(/^"|"$/g, "");
    if (p) files.push(p);
  }
  return files;
}

// --split: ask grok to group the changes into atomic, dependency-ordered commits
// (one concern each), then create them. Returns the commit subjects made; empty
// if it couldn't split (caller then falls back to a single commit).
function atomicCommits(repoRoot: string, diff: string, grokHome: string, grokBin: string): string[] {
  const files = changedFiles(repoRoot);
  if (files.length < 2) return []; // nothing to split
  const styleSamples = gitOut(repoRoot, ["log", "-30", "--pretty=format:%s"]);
  const prompt = [
    "Group these changed files into ATOMIC git commits — one logical concern per commit, in",
    "dependency order (a commit must not depend on a later one). Every file must appear in exactly",
    "one group. Match the repo's commit style from these recent subjects:",
    styleSamples || "(no history — use concise imperative subjects)",
    "",
    "## Changed files",
    files.join("\n"),
    "",
    "## Diff (for context)",
    diff.slice(0, 30_000),
    "",
    'Output ONLY a JSON array, no prose: [{"message": "<commit subject>", "files": ["path", ...]}, ...].',
  ].join("\n");
  const r = spawnGrokHeadless(
    prompt,
    ["-m", DEFAULT_FAST_MODEL, "--always-approve", "--output-format", "plain"],
    { ...process.env, GROK_HOME: grokHome },
    grokBin,
    COMMIT_TIMEOUT_MS
  );
  const text = (r.stdout || "").trim();
  const s = text.indexOf("[");
  const e = text.lastIndexOf("]");
  if (s === -1 || e <= s) return [];
  let plan: { message: string; files: string[] }[];
  try {
    plan = JSON.parse(text.slice(s, e + 1));
  } catch {
    return [];
  }
  const changedSet = new Set(files);
  const made: string[] = [];
  for (const group of plan) {
    if (!group || !group.message || !Array.isArray(group.files)) continue;
    const groupFiles = group.files.filter((f) => changedSet.has(f));
    if (!groupFiles.length) continue;
    const add = runSync("git", ["add", "--", ...groupFiles], { cwd: repoRoot });
    if (!add.ok) continue;
    // Only commit if this actually staged something.
    if (runSync("git", ["diff", "--cached", "--quiet"], { cwd: repoRoot }).ok) continue;
    const c = runSync("git", ["commit", "-m", group.message], { cwd: repoRoot });
    if (c.ok) made.push(group.message.split("\n")[0]!);
  }
  // Catch-all for anything the plan missed, so the tree ends clean.
  if (gitOut(repoRoot, ["status", "--porcelain"]).trim()) {
    runSync("git", ["add", "-A"], { cwd: repoRoot });
    if (!runSync("git", ["diff", "--cached", "--quiet"], { cwd: repoRoot }).ok) {
      const c = runSync("git", ["commit", "-m", "chore: remaining changes"], { cwd: repoRoot });
      if (c.ok) made.push("chore: remaining changes");
    }
  }
  return made;
}

export async function runShip(
  cwd: string,
  args: string[],
  flags: Record<string, string | boolean | number>
): Promise<void> {
  const grokBin = process.env["GROK_BIN"] ?? "grok";
  if (!isGitRepo(cwd)) exitWithError("gg ship needs a git repository.");
  const repoRoot = gitRepoRoot(cwd) ?? cwd;
  const grokHome = resolveGrokHome();

  // What is there to ship? Either uncommitted changes, or commits already made on
  // a feature branch that aren't on the base yet (the "I committed, now PR it" case).
  const dirty = gitOut(repoRoot, ["status", "--porcelain"]).trim();
  const branch = gitOut(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const base = defaultBranch(repoRoot);
  const hasHead = runSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: repoRoot }).ok;
  const ahead =
    hasHead && branch !== base
      ? Number(gitOut(repoRoot, ["rev-list", "--count", `${base}..HEAD`]).trim() || "0")
      : 0;
  if (!dirty && ahead === 0) {
    warn(`Nothing to ship — clean tree and no commits ahead of ${base}.`);
    return;
  }

  header("GrokGoblin ship");

  // ── 1. Verification gate — never ship red work ──────────────────────────
  let evidence = "verification skipped (--no-verify)";
  if (!flags["no-verify"]) {
    const verifyCmd = resolveVerifyCommand(repoRoot, flags["verify"] as string | undefined, false);
    if (verifyCmd) {
      step(`Verifying before ship: ${verifyCmd}`);
      const check = runCheck(verifyCmd, repoRoot, 10 * 60 * 1000);
      if (!check.ok) {
        exitWithError(`Refusing to ship — the check failed:\n${dim(check.output.slice(-1000))}\nFix it, or pass --no-verify to override.`);
      }
      ok(`Check passed: ${verifyCmd}`);
      evidence = `\`${verifyCmd}\` passed`;
    } else {
      info("No deterministic check found — shipping without one (consider `gg review`).");
      evidence = "no automated check available";
    }
  }

  // ── 2. Commit uncommitted work safely; clean+ahead ships existing commits ─
  let workBranch = branch;
  const explicitMsg = args.join(" ").trim();
  let message = explicitMsg;
  if (dirty) {
    // Safety: never commit straight onto the default branch.
    if (branch === base) {
      workBranch = `gg/${slugify(explicitMsg || gitOut(repoRoot, ["log", "-1", "--pretty=%s"]) || "ship")}`;
      step(`On ${base} — creating a feature branch ${workBranch}`);
      const c = runSync("git", ["checkout", "-b", workBranch], { cwd: repoRoot });
      if (!c.ok) exitWithError(`Could not create branch: ${c.stderr || c.stdout}`);
    }
    const diff = gitOut(repoRoot, ["diff", "HEAD"]);
    // --split → atomic commits by concern; else one style-matched commit.
    if (flags["split"] && !explicitMsg) {
      step("Splitting into atomic commits by concern...");
      const made = atomicCommits(repoRoot, diff, grokHome, grokBin);
      if (made.length) {
        made.forEach((m) => ok(`  committed: ${m}`));
        message = made[0]!;
      }
    }
    if (gitOut(repoRoot, ["status", "--porcelain"]).trim()) {
      runSync("git", ["add", "-A"], { cwd: repoRoot });
      message = explicitMsg || generateCommitMessage(repoRoot, diff, grokHome, grokBin);
      const commit = runSync("git", ["commit", "-m", message], { cwd: repoRoot });
      if (!commit.ok) exitWithError(`Commit failed: ${commit.stderr || commit.stdout}`);
      ok(`Committed on ${workBranch}: ${message.split("\n")[0]}`);
    }
  } else {
    info(`${ahead} commit(s) on ${workBranch} ahead of ${base} — ready to ship.`);
  }
  if (!message) message = gitOut(repoRoot, ["log", "-1", "--pretty=%s"]).trim();

  // ── 4. Outward-facing steps are opt-in (push / PR) ───────────────────────
  if (!flags["pr"] && !flags["push"]) {
    print("");
    info(
      dirty
        ? "Committed locally. Add --pr to push and open a pull request (or --push to just push)."
        : `Ready on ${workBranch}. Add --pr to push and open a pull request (or --push to just push).`
    );
    return;
  }
  if (!commandExists("git") || !runSync("git", ["remote"], { cwd: repoRoot }).stdout.trim()) {
    warn("No git remote configured — cannot push.");
    return;
  }
  step(`Pushing ${workBranch}...`);
  const push = runSync("git", ["push", "-u", "origin", workBranch], { cwd: repoRoot });
  if (!push.ok) exitWithError(`Push failed: ${push.stderr || push.stdout}`);
  ok("Pushed.");

  if (flags["pr"]) {
    if (!commandExists("gh")) {
      warn("gh (GitHub CLI) not found — pushed the branch, but can't open the PR. Install gh or open it manually.");
      return;
    }
    const prBody = [
      message.split("\n").slice(1).join("\n").trim() || message,
      "",
      "---",
      `**Verification:** ${evidence}`,
      "**Shipped with:** GrokGoblin (`gg ship`)",
    ].join("\n");
    step("Opening pull request...");
    const pr = runSync("gh", ["pr", "create", "--base", base, "--head", workBranch, "--title", message.split("\n")[0], "--body", prBody], { cwd: repoRoot });
    if (pr.ok) ok(`Pull request opened:\n${pr.stdout.trim()}`);
    else warn(`Could not open PR: ${pr.stderr || pr.stdout}`);
  }

  print("");
  print(bold("Done."));
}
