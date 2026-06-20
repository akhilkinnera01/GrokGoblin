import { spawnSync, type SpawnSyncOptions } from "child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
  ok: boolean;
}

export function runSync(
  cmd: string,
  args: string[],
  options?: SpawnSyncOptions
): RunResult {
  const result = spawnSync(cmd, args, {
    encoding: "utf-8",
    ...options,
  });
  return {
    stdout: (result.stdout ?? "").toString().trim(),
    stderr: (result.stderr ?? "").toString().trim(),
    status: result.status ?? 1,
    ok: (result.status ?? 1) === 0,
  };
}

export function runSyncOrThrow(
  cmd: string,
  args: string[],
  options?: SpawnSyncOptions
): string {
  const result = runSync(cmd, args, options);
  if (!result.ok) {
    throw new Error(
      `Command failed: ${cmd} ${args.join(" ")}\n${result.stderr}`
    );
  }
  return result.stdout;
}

export function commandExists(name: string): boolean {
  // Use argv form (no shell) so the name is never interpreted by a shell —
  // avoids any command-injection surface if a non-literal is ever passed.
  const result = spawnSync("which", [name], { stdio: "ignore" });
  return result.status === 0;
}

export function tmuxAvailable(): boolean {
  return commandExists("tmux");
}

export function isInsideTmux(env = process.env): boolean {
  return Boolean(env["TMUX"]);
}

export function spawnGrok(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  grokBin = "grok"
): never {
  const result = spawnSync(grokBin, args, {
    stdio: "inherit",
    env,
    shell: false,
  });
  process.exit(result.status ?? 0);
}

export function spawnGrokHeadless(
  prompt: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  grokBin = "grok"
): RunResult {
  return runSync(grokBin, ["-p", prompt, ...args], {
    env,
    maxBuffer: 50 * 1024 * 1024,
  });
}

export function tmuxNewSession(
  sessionName: string,
  cmd: string,
  args: string[],
  cwd: string
): RunResult {
  return runSync("tmux", [
    "new-session",
    "-d",
    "-s", sessionName,
    "-c", cwd,
    cmd,
    ...args,
  ]);
}

export function tmuxSendKeys(
  paneId: string,
  text: string,
  submit = true
): RunResult {
  const keys = submit ? [text, "Enter"] : [text];
  return runSync("tmux", ["send-keys", "-t", paneId, ...keys]);
}

export function tmuxListSessions(): string[] {
  const result = runSync("tmux", ["list-sessions", "-F", "#{session_name}"]);
  if (!result.ok) return [];
  return result.stdout.split("\n").filter(Boolean);
}

export function tmuxKillSession(sessionName: string): void {
  runSync("tmux", ["kill-session", "-t", sessionName]);
}

export function tmuxHasSession(sessionName: string): boolean {
  const sessions = tmuxListSessions();
  return sessions.includes(sessionName);
}

export function tmuxAttach(sessionName: string): never {
  const result = spawnSync("tmux", ["attach-session", "-t", sessionName], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 0);
}

export function gitWorktreeList(cwd: string): string[] {
  const result = runSync("git", ["worktree", "list", "--porcelain"], { cwd });
  if (!result.ok) return [];
  return result.stdout
    .split("\n\n")
    .map((block) => {
      const match = block.match(/^worktree (.+)/m);
      return match?.[1] ?? "";
    })
    .filter(Boolean);
}

export function gitWorktreeAdd(
  repoDir: string,
  worktreePath: string,
  branch: string
): RunResult {
  return runSync("git", ["worktree", "add", "-B", branch, worktreePath], {
    cwd: repoDir,
  });
}

export function isGitRepo(cwd: string): boolean {
  return runSync("git", ["rev-parse", "--git-dir"], { cwd }).ok;
}

export function gitRepoRoot(cwd: string): string | null {
  const result = runSync("git", ["rev-parse", "--show-toplevel"], { cwd });
  return result.ok ? result.stdout : null;
}
