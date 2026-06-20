import { createHash } from "crypto";
import { existsSync, mkdirSync, lstatSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readTomlFile } from "./toml.js";

// --- Why this exists -------------------------------------------------------
//
// grok 0.2.x runs a persistent "leader" daemon behind `~/.grok/leader.sock`
// that caches MCP server connections cross-session. When you start a new `grok`
// run, it attaches to the *already running* leader — so edits to your MCP config
// (the `[mcp_servers.*]` tables in config.toml) are silently ignored until that
// leader process dies. There is no `--mcp-config` flag to force a reload.
//
// The folklore workaround is to fork `$HOME` (or `GROK_HOME`) per run so
// `~/.grok/leader.sock` resolves somewhere fresh and a brand-new leader spins
// up. It works, but it also throws away everything else the grok home holds:
// auth/credentials, cross-session memory, installed skills, and session history.
// Ugly, and slow (cold auth + cold memory every run).
//
// GrokGoblin isolates ONLY the leader. grok exposes `--leader-socket <PATH>`,
// so we point each run at a socket whose name is a fingerprint of the effective
// MCP config:
//
//   - config unchanged  -> same socket path -> warm leader is reused (fast)
//   - config changed     -> new socket path  -> a fresh leader starts and picks
//                                               up the new servers immediately
//
// Auth, memory, skills, and sessions all stay in the real grok home. This is the
// whole point: correct MCP reloads without the HOME-forking sledgehammer.
//
// Escape hatches:
//   GG_NO_LEADER_ISOLATION=1  -> use grok's default leader (opt out entirely)
//   GG_LEADER_SOCKET=<path>   -> pin an explicit socket path

const LEADER_DIR = "leaders";

// Unix domain socket paths are capped (~104 bytes on macOS, ~108 on Linux). If
// the grok-home-based path would exceed this, fall back to the system temp dir,
// which is short and writable.
const MAX_SOCKET_PATH = 100;

/**
 * Stable fingerprint of the MCP configuration grok will actually load for this
 * run: the user config (grokHome/config.toml) plus the project override
 * (cwd/.grok/config.toml). Only the MCP-relevant tables are hashed, so changing
 * an unrelated config key does NOT needlessly spawn a new leader.
 */
export function mcpFingerprint(grokHome: string, cwd: string): string {
  const sources: unknown[] = [];
  for (const path of [
    resolveConfigPath(grokHome),
    join(cwd, ".grok", "config.toml"),
  ]) {
    if (existsSync(path)) {
      const toml = readTomlFile(path);
      // grok stores servers under `[mcp_servers.*]`; older/alt layouts may use
      // an `[mcp]` table. Hash whichever are present so any MCP edit is caught.
      sources.push(toml["mcp_servers"] ?? null);
      sources.push(toml["mcp"] ?? null);
    } else {
      sources.push(null, null);
    }
  }
  return createHash("sha1")
    .update(JSON.stringify(sources))
    .digest("hex")
    .slice(0, 12);
}

function resolveConfigPath(grokHome: string): string {
  return join(grokHome, "config.toml");
}

/**
 * The per-config leader socket path for this run, or `undefined` when leader
 * isolation is disabled (so callers append nothing and grok uses its default).
 */
export function resolveLeaderSocket(
  grokHome: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (env["GG_NO_LEADER_ISOLATION"]) return undefined;
  if (env["GG_LEADER_SOCKET"]) return env["GG_LEADER_SOCKET"];

  // Never let leader isolation break a launch: any failure (unreadable config,
  // unwritable dir, odd filesystem) falls back to grok's default leader so the
  // session still starts. Isolation is an optimization/safeguard, not a gate.
  try {
    const fingerprint = mcpFingerprint(grokHome, cwd);
    const fileName = `gg-${fingerprint}.sock`;

    // Preferred: under the user's own grok home (already per-user, private).
    const preferredDir = join(grokHome, LEADER_DIR);
    const preferred = join(preferredDir, fileName);
    if (preferred.length <= MAX_SOCKET_PATH && prepareSafeDir(preferredDir)) {
      return preferred;
    }

    // grok home path too long for a valid socket — fall back to a PER-USER temp
    // dir (uid-namespaced) so another local user cannot pre-create / squat our
    // socket on a shared /tmp. If the dir can't be made safe, give up isolation.
    const fallbackDir = join(tmpdir(), `grokgoblin-leaders-${currentUid()}`);
    const fallback = join(fallbackDir, fileName);
    if (fallback.length <= MAX_SOCKET_PATH && prepareSafeDir(fallbackDir)) {
      return fallback;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function currentUid(): string {
  // process.getuid is undefined on Windows; "u" keeps the path valid there.
  const fn = (process as NodeJS.Process & { getuid?: () => number }).getuid;
  return typeof fn === "function" ? String(fn.call(process)) : "u";
}

/**
 * Create `dir` (mode 0700) if missing, and ensure an existing one is safe to put
 * a listening socket in: a real directory (not a symlink — symlink swaps are a
 * classic redirect attack), owned by us, and not group/other-writable (which
 * would let another user squat or hijack the predictable socket path). Returns
 * false on any doubt so the caller falls back to grok's default leader rather
 * than trusting a suspicious directory.
 */
function prepareSafeDir(dir: string): boolean {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      return true;
    }
    const st = lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) return false;
    const uidFn = (process as NodeJS.Process & { getuid?: () => number }).getuid;
    if (typeof uidFn === "function" && st.uid !== uidFn.call(process)) return false;
    // Reject group/other write bits; tighten to 0700 defensively if we own it.
    if (st.mode & 0o077) {
      chmodSync(dir, 0o700);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * `--leader-socket <PATH>` args for grok, or an empty array when isolation is
 * off. Spread this into every grok invocation so MCP config edits take effect.
 */
export function leaderSocketArgs(
  grokHome: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const socket = resolveLeaderSocket(grokHome, cwd, env);
  return socket ? ["--leader-socket", socket] : [];
}
