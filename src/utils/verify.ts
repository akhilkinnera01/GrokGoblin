import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { runSync } from "./exec.js";

// The deterministic verification gate. The whole point of GrokGoblin's loop over
// the bare "QA agent" pattern is that completion is decided by a REAL command
// (tests/build/typecheck) the harness runs itself — ground truth, ~0 model
// tokens — not by an agent grading its own vibes. When no runnable check exists
// (e.g. a data-extraction task), the loop falls back to an independent checker.

export interface CheckResult {
  /** The command that ran (empty when no check was available). */
  command: string;
  /** True when a check ran AND passed. */
  ok: boolean;
  /** True when no deterministic check could be detected (caller should fall back). */
  skipped: boolean;
  /** Process exit code (1 when skipped/failed without a code). */
  code: number;
  /** Killed for exceeding the wall-clock budget. */
  timedOut: boolean;
  /** Tail of combined stdout+stderr, bounded for prompt/logging use. */
  output: string;
}

const CHECK_OUTPUT_BYTES = 4000;

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Pick the package-manager run prefix from whichever lockfile is present.
function nodeRunner(repoRoot: string): { run: string; exec: string } {
  if (existsSync(join(repoRoot, "pnpm-lock.yaml")))
    return { run: "pnpm", exec: "pnpm exec" };
  if (existsSync(join(repoRoot, "yarn.lock")))
    return { run: "yarn", exec: "yarn" };
  if (existsSync(join(repoRoot, "bun.lockb")))
    return { run: "bun run", exec: "bunx" };
  return { run: "npm run", exec: "npx" };
}

// Auto-detect the cheapest meaningful "is it correct?" command for this repo.
// Returns null when nothing safe to run is found — the caller then uses the
// independent-checker fallback rather than fabricating a green light.
export function detectVerifyCommand(repoRoot: string): string | null {
  // Node / TypeScript
  const pkgPath = join(repoRoot, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = readJson(pkgPath);
    const scripts = (pkg?.["scripts"] as Record<string, string>) ?? {};
    const { run, exec } = nodeRunner(repoRoot);
    const has = (name: string): boolean => {
      const s = scripts[name];
      // npm init writes a placeholder test script that always "passes" — ignore it.
      return Boolean(s) && !/no test specified/i.test(s);
    };
    // Prefer real tests (ground truth) > typecheck > lint > build (build is the
    // weakest signal of correctness, so it comes last).
    if (has("test")) return `${run} test`;
    if (has("typecheck")) return `${run} typecheck`;
    if (has("tsc")) return `${run} tsc`;
    if (has("lint")) return `${run} lint`;
    if (has("build")) return `${run} build`;
    if (existsSync(join(repoRoot, "tsconfig.json")))
      return `${exec} tsc --noEmit`;
  }

  // Rust
  if (existsSync(join(repoRoot, "Cargo.toml"))) return "cargo test";

  // Go
  if (existsSync(join(repoRoot, "go.mod"))) return "go test ./...";

  // Python
  if (
    existsSync(join(repoRoot, "pyproject.toml")) ||
    existsSync(join(repoRoot, "setup.py")) ||
    existsSync(join(repoRoot, "pytest.ini")) ||
    existsSync(join(repoRoot, "tests"))
  ) {
    return "python3 -m pytest -q";
  }

  // Make
  if (existsSync(join(repoRoot, "Makefile"))) {
    try {
      const mk = readFileSync(join(repoRoot, "Makefile"), "utf-8");
      if (/^test:/m.test(mk)) return "make test";
    } catch {
      /* ignore */
    }
  }

  return null;
}

// Run a verification command through the shell (commands like `npm test &&
// npm run build` need shell semantics). The command is project-owned (detected
// or user-supplied via --verify), so shell execution is expected here.
export function runCheck(
  command: string,
  cwd: string,
  timeoutMs?: number
): CheckResult {
  if (!command.trim()) {
    return {
      command: "",
      ok: false,
      skipped: true,
      code: 1,
      timedOut: false,
      output: "",
    };
  }
  const res = runSync("sh", ["-c", command], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
    ...(timeoutMs && timeoutMs > 0
      ? { timeout: timeoutMs, killSignal: "SIGTERM" as const }
      : {}),
  });
  const combined = [res.stdout, res.stderr].filter(Boolean).join("\n");
  return {
    command,
    ok: res.ok && !res.timedOut,
    skipped: false,
    code: res.status,
    timedOut: Boolean(res.timedOut),
    output: combined.slice(-CHECK_OUTPUT_BYTES),
  };
}

// Resolve the effective verify command: explicit --verify wins, then auto-detect,
// unless verification was explicitly disabled.
export function resolveVerifyCommand(
  repoRoot: string,
  explicit: string | undefined,
  disabled: boolean
): string | null {
  if (disabled) return null;
  if (explicit && explicit.trim()) return explicit.trim();
  return detectVerifyCommand(repoRoot);
}
