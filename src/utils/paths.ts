import { homedir } from "os";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync } from "fs";
import type { SetupScope } from "../types/index.js";

export const GG_VERSION = "0.1.0";
export const GG_STATE_DIR = ".grokgoblin";
export const DEFAULT_GROK_HOME = join(homedir(), ".grok");
export const DEFAULT_FRONTIER_MODEL = "grok-build";
export const DEFAULT_FAST_MODEL = "grok-composer-2.5-fast";
// Models exposed by the grok CLI (grok 0.2.x). Used to validate `gg config model`.
export const KNOWN_MODELS = [DEFAULT_FRONTIER_MODEL, DEFAULT_FAST_MODEL];

// The canonical set of skills GrokGoblin installs. Used both to install them and
// to filter "gg skills list" so it shows GrokGoblin's own skills, not every
// skill discovered in ~/.grok/skills (which may include many from other tools).
export const GROKGOBLIN_SKILLS = [
  "dig",
  "goblinplan",
  "ralph",
  "quest",
  "cruise",
  "code-review",
  "tdd",
  "goblins",
];

// As of grok 0.2.x neither available model supports the `reasoningEffort`
// parameter (models_cache: supports_reasoning_effort = false), so passing
// --effort returns HTTP 400. Add model ids here as grok ships effort support.
export const EFFORT_CAPABLE_MODELS: string[] = [];

export function modelSupportsEffort(model: string | undefined): boolean {
  return model !== undefined && EFFORT_CAPABLE_MODELS.includes(model);
}

export function resolveGrokHome(env = process.env): string {
  return env["GROK_HOME"] ?? DEFAULT_GROK_HOME;
}

export function resolveGrokHomeForScope(
  cwd: string,
  scope: SetupScope,
  env = process.env
): string {
  if (scope === "project") return join(cwd, ".grok");
  return resolveGrokHome(env);
}

export function resolveGgStateDir(cwd: string, env = process.env): string {
  return env["GG_ROOT"] ?? join(cwd, GG_STATE_DIR);
}

export function resolveGgSessionStateDir(
  cwd: string,
  sessionId: string,
  env = process.env
): string {
  return join(resolveGgStateDir(cwd, env), "state", sessionId);
}

export function resolveGgLogsDir(cwd: string, env = process.env): string {
  return join(resolveGgStateDir(cwd, env), "logs");
}

export function resolveGgPlansDir(cwd: string, env = process.env): string {
  return join(resolveGgStateDir(cwd, env), "plans");
}

export function resolveModeStatePath(
  mode: string,
  cwd: string,
  sessionId?: string,
  env = process.env
): string {
  const stateDir = sessionId
    ? resolveGgSessionStateDir(cwd, sessionId, env)
    : join(resolveGgStateDir(cwd, env), "state");
  return join(stateDir, `${mode}-state.json`);
}

export function resolveSkillActivePath(cwd: string, env = process.env): string {
  return join(resolveGgStateDir(cwd, env), "state", "skill-active.json");
}

export function resolveSessionStatePath(
  cwd: string,
  sessionId: string,
  env = process.env
): string {
  return join(
    resolveGgStateDir(cwd, env),
    "state",
    sessionId,
    "session.json"
  );
}

export function resolveHooksLogPath(cwd: string, env = process.env): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(resolveGgLogsDir(cwd, env), `hooks-${date}.jsonl`);
}

export function resolveProjectMemoryPath(cwd: string, env = process.env): string {
  return join(resolveGgStateDir(cwd, env), "memory", "project.md");
}

export function resolveNotepadPath(cwd: string, env = process.env): string {
  return join(resolveGgStateDir(cwd, env), "notepad.md");
}

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function resolveGgBinPath(env = process.env): string {
  return env["GG_ENTRY_PATH"] ?? process.argv[1] ?? "gg";
}

export function resolveGrokBinPath(env = process.env): string {
  return env["GROK_BIN"] ?? "grok";
}

export function ggSessionId(env = process.env): string {
  return (
    env["GG_SESSION_ID"] ?? `gg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

export function resolveGrokConfigPath(grokHome: string): string {
  return join(grokHome, "config.toml");
}

export function resolveAgentsMdPath(grokHome: string): string {
  return join(grokHome, "AGENTS.md");
}

export function resolveSkillsDir(grokHome: string): string {
  return join(grokHome, "skills");
}

export function resolveHooksDir(grokHome: string): string {
  return join(grokHome, "hooks");
}

export function resolvePromptsDir(grokHome: string): string {
  return join(grokHome, "prompts");
}

export function resolveGgSessionInstructionsPath(
  grokHome: string,
  sessionId: string
): string {
  return join(grokHome, `.grokgoblin-session-${sessionId}.md`);
}

export function packageDir(): string {
  // fileURLToPath decodes percent-encoding (e.g. %20 for spaces in the path),
  // unlike url.pathname which would leave the path broken on disk.
  const filePath = fileURLToPath(import.meta.url);
  return resolve(filePath, "../../../");
}

export function packageSkillsDir(): string {
  return join(packageDir(), "skills");
}

export function packagePromptsDir(): string {
  return join(packageDir(), "prompts");
}

export function packageHooksDir(): string {
  return join(packageDir(), "hooks");
}
