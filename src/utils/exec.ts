import { spawnSync, spawn, type SpawnSyncOptions } from "child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
  ok: boolean;
  /** True when the process was killed for exceeding its wall-clock timeout. */
  timedOut?: boolean;
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
  // spawnSync reports a timeout via error.code === "ETIMEDOUT" and status === null.
  const timedOut =
    (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  return {
    stdout: (result.stdout ?? "").toString().trim(),
    stderr: (result.stderr ?? "").toString().trim(),
    status: result.status ?? 1,
    ok: (result.status ?? 1) === 0,
    timedOut,
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
  grokBin = "grok",
  // Wall-clock cap for a single headless invocation. When a loop iteration hangs
  // (the "agent stuck, restart the terminal" failure), spawnSync sends killSignal
  // after timeoutMs so the loop can recover instead of blocking forever.
  timeoutMs?: number
): RunResult {
  const result = runSync(grokBin, ["-p", prompt, ...args], {
    env,
    maxBuffer: 50 * 1024 * 1024,
    ...(timeoutMs && timeoutMs > 0
      ? { timeout: timeoutMs, killSignal: "SIGTERM" as const }
      : {}),
  });
  // spawnSync sets status=null on timeout; surface it as a non-ok result with a
  // clear marker so the caller can treat a hung iteration as "stuck", not "done".
  return result;
}

// Async variant of spawnGrokHeadless so multiple workers can run truly in
// parallel (spawnSync blocks the event loop and cannot). Used by the parallel
// Goblins fan-out, where each worker runs in its own git worktree.
export function spawnGrokHeadlessAsync(
  prompt: string,
  args: string[],
  opts: {
    env?: NodeJS.ProcessEnv;
    grokBin?: string;
    cwd?: string;
    timeoutMs?: number;
  } = {}
): Promise<RunResult> {
  const { env = process.env, grokBin = "grok", cwd, timeoutMs } = opts;
  return new Promise((resolvePromise) => {
    const child = spawn(grokBin, ["-p", prompt, ...args], { env, cwd });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const MAX = 50 * 1024 * 1024;
    child.stdout?.on("data", (d) => {
      if (stdout.length < MAX) stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      if (stderr.length < MAX) stderr += d.toString();
    });
    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, timeoutMs)
        : null;
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolvePromise({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        status: code ?? 1,
        ok: code === 0 && !timedOut,
        timedOut,
      });
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolvePromise({
        stdout: stdout.trim(),
        stderr: (stderr + "\n" + String(err)).trim(),
        status: 1,
        ok: false,
        timedOut,
      });
    });
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
