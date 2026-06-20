import { join, resolve, basename } from "path";
import { existsSync, mkdirSync, statSync } from "fs";
import { runSync, gitRepoRoot } from "./exec.js";

// All GrokGoblin worktrees live in a sibling dir so the main checkout stays
// clean and cleanup is obvious: <parent>/<repo>.gg-worktrees/<name>
const WORKTREE_SUFFIX = ".gg-worktrees";
const BRANCH_PREFIX = "gg/";

const GOBLIN_ADJECTIVES = [
  "sneaky", "grimy", "crafty", "sly", "murky", "cunning",
  "feral", "gnarly", "scrappy", "wily", "shifty", "rowdy",
];

export interface GgWorktree {
  name: string;        // short name (dir + branch suffix)
  branch: string;      // full branch (gg/<name> or whatever git reports)
  path: string;        // absolute worktree path
  dirty: boolean;      // has uncommitted changes
  ahead: number;       // commits ahead of base
  isGg: boolean;       // lives under our worktrees dir
  ageMs: number;       // since dir mtime
}

export function worktreesRoot(repoRoot: string): string {
  return join(resolve(repoRoot, ".."), `${basename(repoRoot)}${WORKTREE_SUFFIX}`);
}

// Memorable, collision-resistant default name, e.g. "sneaky-a3f2".
export function generateWorktreeName(): string {
  const adj = GOBLIN_ADJECTIVES[Math.floor(Math.random() * GOBLIN_ADJECTIVES.length)];
  const hex = Math.random().toString(16).slice(2, 6);
  return `${adj}-${hex}`;
}

// Turn a user-supplied name/task into a safe worktree name.
export function slugifyWorktreeName(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || generateWorktreeName();
}

export function worktreePathFor(repoRoot: string, name: string): string {
  return join(worktreesRoot(repoRoot), name);
}

function gitDirty(path: string): boolean {
  const r = runSync("git", ["status", "--porcelain"], { cwd: path });
  return r.ok && r.stdout.trim().length > 0;
}

function gitAhead(path: string, base: string): number {
  const r = runSync("git", ["rev-list", "--count", `${base}..HEAD`], { cwd: path });
  const n = parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function defaultBase(repoRoot: string): string {
  for (const b of ["main", "master"]) {
    if (runSync("git", ["rev-parse", "--verify", b], { cwd: repoRoot }).ok) return b;
  }
  return "HEAD";
}

// Parse `git worktree list --porcelain` into rich records (excludes main).
export function listWorktrees(cwd: string): GgWorktree[] {
  const repoRoot = gitRepoRoot(cwd);
  if (!repoRoot) return [];
  const r = runSync("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot });
  if (!r.ok) return [];
  const root = worktreesRoot(repoRoot);
  const base = defaultBase(repoRoot);
  const out: GgWorktree[] = [];

  for (const block of r.stdout.split("\n\n")) {
    const pathMatch = block.match(/^worktree (.+)$/m);
    if (!pathMatch) continue;
    const path = pathMatch[1]!;
    if (path === repoRoot) continue; // skip the main checkout
    const branchMatch = block.match(/^branch (.+)$/m);
    const branch = branchMatch
      ? branchMatch[1]!.replace("refs/heads/", "")
      : "(detached)";
    let ageMs = 0;
    try {
      ageMs = Date.now() - statSync(path).mtimeMs;
    } catch {}
    out.push({
      name: basename(path),
      branch,
      path,
      dirty: existsSync(path) ? gitDirty(path) : false,
      ahead: existsSync(path) ? gitAhead(path, base) : 0,
      isGg: path.startsWith(root),
      ageMs,
    });
  }
  return out;
}

export interface CreateResult {
  path: string;
  branch: string;
  name: string;
  created: boolean;
}

// Create (or reuse) a GrokGoblin worktree with a new branch off the current HEAD.
export function createWorktree(repoRoot: string, name: string): CreateResult {
  const branch = `${BRANCH_PREFIX}${name}`;
  const path = worktreePathFor(repoRoot, name);
  if (existsSync(path)) {
    return { path, branch, name, created: false };
  }
  mkdirSync(resolve(path, ".."), { recursive: true });
  const r = runSync("git", ["worktree", "add", "-B", branch, path], { cwd: repoRoot });
  if (!r.ok) {
    throw new Error(`git worktree add failed: ${r.stderr || r.stdout}`);
  }
  return { path, branch, name, created: true };
}

export interface RemoveResult {
  ok: boolean;
  reason?: string;
}

export function removeWorktree(
  repoRoot: string,
  name: string,
  opts: { force?: boolean; deleteBranch?: boolean } = {}
): RemoveResult {
  const wt = listWorktrees(repoRoot).find((w) => w.name === name || w.branch === name);
  if (!wt) return { ok: false, reason: "not found" };
  if (wt.dirty && !opts.force) {
    return { ok: false, reason: "has uncommitted changes (use --force)" };
  }
  const args = ["worktree", "remove", wt.path];
  if (opts.force) args.push("--force");
  const r = runSync("git", args, { cwd: repoRoot });
  if (!r.ok) return { ok: false, reason: r.stderr || r.stdout };
  if (opts.deleteBranch) {
    runSync("git", ["branch", "-D", wt.branch], { cwd: repoRoot });
  }
  return { ok: true };
}

export function isBranchMerged(repoRoot: string, branch: string): boolean {
  const base = defaultBase(repoRoot);
  const r = runSync("git", ["branch", "--merged", base], { cwd: repoRoot });
  if (!r.ok) return false;
  return r.stdout
    .split("\n")
    .map((l) => l.replace(/^[*+]?\s*/, "").trim())
    .includes(branch);
}

export function formatAge(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
