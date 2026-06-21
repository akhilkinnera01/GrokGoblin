import { isGitRepo, gitRepoRoot } from "../utils/exec.js";
import {
  listWorktrees,
  createWorktree,
  removeWorktree,
  isBranchMerged,
  generateWorktreeName,
  slugifyWorktreeName,
  formatAge,
  worktreesRoot,
  type GgWorktree,
} from "../utils/worktree.js";
import { header, print, bold, dim, ok, warn, info, exitWithError } from "../utils/print.js";

// Friendly, consistent banner shown whenever a worktree becomes the active
// workspace — this is the "isolation messaging" that makes worktrees feel safe.
export function printIsolationBanner(wt: { path: string; branch: string; name: string }): void {
  print("");
  print(bold("🛡  Isolated worktree"));
  print(`   ${dim("workspace")}  ${wt.path}`);
  print(`   ${dim("branch")}     ${wt.branch}`);
  print("");
  print(dim("   Changes here stay on this branch — your main checkout is untouched."));
  print(dim(`   When you're done:  goblin worktree rm ${wt.name} --branch`));
  print("");
}

function requireRepo(cwd: string): string {
  if (!isGitRepo(cwd)) {
    exitWithError("Not a git repository. Worktrees need a git repo (try `git init`).");
  }
  return gitRepoRoot(cwd) ?? cwd;
}

function statusLabel(w: GgWorktree): string {
  const bits: string[] = [];
  if (w.dirty) bits.push("✎ dirty");
  if (w.ahead > 0) bits.push(`↑${w.ahead}`);
  if (bits.length === 0) bits.push("clean");
  return bits.join(" ");
}

function runList(cwd: string): void {
  const repoRoot = requireRepo(cwd);
  const all = listWorktrees(repoRoot);

  header("GrokGoblin worktrees");
  if (all.length === 0) {
    print(dim("No worktrees yet."));
    print("");
    print(`Create one:  ${bold("goblin worktree new")}  ${dim("(smart name)")}`);
    print(`         or:  ${bold("goblin worktree new feature-x")}`);
    return;
  }

  for (const w of all) {
    const tag = w.isGg ? "" : dim(" (external)");
    print(`  ${bold(w.name.padEnd(22))} ${statusLabel(w).padEnd(16)} ${dim(formatAge(w.ageMs) + " old")}${tag}`);
    print(`    ${dim(w.branch)}  ${dim("·")}  ${dim(w.path)}`);
  }
  print("");
  print(dim(`Stored under: ${worktreesRoot(repoRoot)}`));
  print(dim("Enter one:  cd \"$(goblin worktree path <name>)\"   ·   Clean merged:  goblin worktree clean"));
}

function runNew(cwd: string, args: string[]): void {
  const repoRoot = requireRepo(cwd);
  const raw = args.join(" ").trim();
  const name = raw ? slugifyWorktreeName(raw) : generateWorktreeName();

  const res = createWorktree(repoRoot, name);
  if (res.created) {
    ok(`Created worktree "${res.name}"`);
  } else {
    info(`Reusing existing worktree "${res.name}"`);
  }
  printIsolationBanner(res);
  print(`Jump in:  ${bold(`cd "${res.path}"`)}`);
}

function runRemove(cwd: string, args: string[], flags: Record<string, unknown>): void {
  const repoRoot = requireRepo(cwd);
  const name = args[0];
  if (!name) exitWithError("Usage: goblin worktree rm <name> [--force] [--branch]");

  const res = removeWorktree(repoRoot, name, {
    force: Boolean(flags["force"]),
    deleteBranch: Boolean(flags["branch"]),
  });
  if (!res.ok) {
    exitWithError(`Could not remove "${name}": ${res.reason}`);
  }
  ok(`Removed worktree "${name}"${flags["branch"] ? " and its branch" : ""}`);
}

function runClean(cwd: string, flags: Record<string, unknown>): void {
  const repoRoot = requireRepo(cwd);
  const all = listWorktrees(repoRoot).filter((w) => w.isGg);
  const force = Boolean(flags["force"]);
  const all_ = Boolean(flags["all"]);

  // Default: prune worktrees whose branch is already merged and that are clean.
  // --all also removes unmerged-but-clean ones. --force allows dirty removal.
  const candidates = all.filter((w) => {
    if (w.dirty && !force) return false;
    if (all_) return true;
    return isBranchMerged(repoRoot, w.branch);
  });

  if (candidates.length === 0) {
    info("Nothing to clean.");
    const skipped = all.filter((w) => w.dirty && !force);
    if (skipped.length > 0) {
      print(dim(`(${skipped.length} dirty worktree(s) skipped — use --force to remove them)`));
    }
    return;
  }

  let removed = 0;
  for (const w of candidates) {
    const res = removeWorktree(repoRoot, w.name, { force, deleteBranch: true });
    if (res.ok) {
      ok(`Removed "${w.name}" (${w.branch})`);
      removed++;
    } else {
      warn(`Skipped "${w.name}": ${res.reason}`);
    }
  }
  print("");
  info(`Cleaned ${removed} worktree(s).`);
}

function runPath(cwd: string, args: string[]): void {
  const repoRoot = requireRepo(cwd);
  const name = args[0];
  if (!name) exitWithError("Usage: goblin worktree path <name>");
  const wt = listWorktrees(repoRoot).find((w) => w.name === name || w.branch === name);
  if (!wt) exitWithError(`No worktree named "${name}".`);
  // Bare path on stdout so it composes with `cd "$(goblin worktree path x)"`.
  process.stdout.write(wt.path + "\n");
}

function printWorktreeHelp(): void {
  header("goblin worktree — isolated workspaces");
  print("");
  print(bold("Usage:"));
  print("  goblin worktree                 List worktrees (status, age, branch)");
  print("  goblin worktree new [name]      Create a worktree (smart goblin name if omitted)");
  print("  goblin worktree rm <name>       Remove a worktree (--force dirty, --branch delete branch)");
  print("  goblin worktree clean           Remove merged, clean worktrees (--all, --force)");
  print("  goblin worktree path <name>     Print a worktree's path (for cd)");
  print("");
  print(dim("Worktrees live in a sibling <repo>.gg-worktrees/ dir; branches are prefixed gg/."));
}

export async function runWorktree(
  cwd: string,
  args: string[],
  flags: Record<string, string | boolean | number> = {}
): Promise<void> {
  const sub = (args[0] ?? "list").toLowerCase();
  const rest = args.slice(1);

  switch (sub) {
    case "list":
    case "ls":
      runList(cwd);
      break;
    case "new":
    case "add":
    case "create":
      runNew(cwd, rest);
      break;
    case "rm":
    case "remove":
    case "delete":
      runRemove(cwd, rest, flags);
      break;
    case "clean":
    case "prune":
      runClean(cwd, flags);
      break;
    case "path":
      runPath(cwd, rest);
      break;
    case "help":
    case "--help":
    case "-h":
      printWorktreeHelp();
      break;
    default:
      // `goblin worktree list` is the implicit default, but if the first token isn't a
      // known subcommand, treat the whole thing as a name for `new`.
      runNew(cwd, args);
  }
}
