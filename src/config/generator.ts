import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { readTomlFile, writeTomlFile, mergeTomlFile } from "../utils/toml.js";
import {
  resolveGrokConfigPath,
  resolveHooksDir,
  resolveSkillsDir,
  DEFAULT_FRONTIER_MODEL,
} from "../utils/paths.js";

const GG_AGENTS_MD_START = "<!-- GROKGOBLIN:AGENTS:START -->";
const GG_AGENTS_MD_END = "<!-- GROKGOBLIN:AGENTS:END -->";

// Real grok config.toml schema (the subset GrokGoblin manages). See grok README
// "Configuration". GrokGoblin instructions are delivered via AGENTS.md, NOT config.
export interface GrokConfigShape {
  cli?: { auto_update?: boolean };
  models?: { default?: string; web_search?: string };
  features?: { support_permission?: boolean; telemetry?: boolean };
  session?: { auto_compact_threshold_percent?: number };
  ui?: { permission_mode?: string };
  [key: string]: unknown;
}

// Bogus top-level keys an earlier GrokGoblin version wrote that grok does not
// understand. Stripped on setup so we don't leave dead config behind.
const LEGACY_GG_CONFIG_KEYS = [
  "model_context_window",
  "auto_compact_threshold",
  "developer_instructions",
];

export function readGrokConfig(grokHome: string): GrokConfigShape {
  const path = resolveGrokConfigPath(grokHome);
  return readTomlFile(path) as GrokConfigShape;
}

export function writeGrokConfig(
  grokHome: string,
  updates: Record<string, unknown>
): void {
  const configPath = resolveGrokConfigPath(grokHome);
  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  mergeTomlFile(configPath, updates);
}

// Conservatively set GrokGoblin's preferred grok defaults — only keys that are absent,
// so we never clobber a value the user (or grok) already chose.
export function ensureGrokConfigDefaults(grokHome: string): void {
  const config = readGrokConfig(grokHome);
  const updates: Record<string, unknown> = {};

  if (!config.models?.default) {
    updates.models = { default: DEFAULT_FRONTIER_MODEL };
  }
  if (config.session?.auto_compact_threshold_percent === undefined) {
    updates.session = { auto_compact_threshold_percent: 85 };
  }

  if (Object.keys(updates).length > 0) {
    writeGrokConfig(grokHome, updates);
  }
}

// --- Generic dotted-key access for the `gg config` command ---

function coerceTomlValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d*\.\d+$/.test(raw)) return Number(raw);
  return raw;
}

export function getGrokConfigValue(
  grokHome: string,
  dottedKey: string
): unknown {
  const config = readGrokConfig(grokHome) as Record<string, unknown>;
  let node: unknown = config;
  for (const part of dottedKey.split(".")) {
    if (node && typeof node === "object" && part in (node as object)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return node;
}

export function setGrokConfigValue(
  grokHome: string,
  dottedKey: string,
  rawValue: string
): unknown {
  const parts = dottedKey.split(".");
  const value = coerceTomlValue(rawValue);
  // Build a nested object {a:{b:{c:value}}} and deep-merge it into config.
  const update: Record<string, unknown> = {};
  let cursor = update;
  parts.forEach((part, i) => {
    if (i === parts.length - 1) {
      cursor[part] = value;
    } else {
      cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
  });
  writeGrokConfig(grokHome, update);
  return value;
}

// Remove dead keys written by older GrokGoblin versions (no-ops grok ignores).
export function migrateLegacyGgConfig(grokHome: string): boolean {
  const configPath = resolveGrokConfigPath(grokHome);
  if (!existsSync(configPath)) return false;
  const config = readTomlFile(configPath) as Record<string, unknown>;
  let changed = false;
  for (const key of LEGACY_GG_CONFIG_KEYS) {
    if (key in config) {
      delete config[key];
      changed = true;
    }
  }
  if (changed) writeTomlFile(configPath, config);
  return changed;
}

// grok loads global hooks from `<grokHome>/hooks/hooks.json` using the
// Claude Code hook schema. Matchers use grok's tool names: `Shell` (commands),
// `Write` / `StrReplace` (file edits). Verified against grok 0.2.56.
export interface GrokHookCommand {
  type: "command";
  command: string;
  async?: boolean;
}
export interface GrokHookMatcher {
  matcher: string;
  hooks: GrokHookCommand[];
}
export interface GrokHooksFile {
  hooks: Record<string, GrokHookMatcher[]>;
}

// A hook group is "ours" if any of its commands invoke the GrokGoblin bin
// (either `grokgoblin hook ...` or the short `gg hook ...`). Quote-tolerant, since
// the binary path is shell-quoted in the command (e.g. `'grokgoblin' hook ...`).
const GG_HOOK_CMD_RE = /(grokgoblin|gg)['"]?\s+hook\b/;
function isGgCommand(command: string): boolean {
  return GG_HOOK_CMD_RE.test(command);
}

function isGgMatcher(group: GrokHookMatcher): boolean {
  return group.hooks.some((h) => isGgCommand(h.command));
}

// grok runs hook `command` strings through a shell, so the binary path must be
// shell-quoted — otherwise a GG_ENTRY_PATH containing spaces (e.g. an absolute
// path under "My Workspace/") would split into the wrong argv or be abusable.
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function buildGgHookMatchers(
  ggBin: string
): Record<string, GrokHookMatcher[]> {
  const bin = shellQuote(ggBin);
  return {
    SessionStart: [
      {
        matcher: "startup|clear|compact",
        hooks: [
          { type: "command", command: `${bin} hook session-start`, async: true },
        ],
      },
    ],
    SessionEnd: [
      {
        matcher: "*",
        hooks: [
          { type: "command", command: `${bin} hook session-end`, async: true },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "Shell",
        hooks: [{ type: "command", command: `${bin} hook pre-command` }],
      },
    ],
    PostToolUse: [
      {
        matcher: "Write|StrReplace",
        hooks: [{ type: "command", command: `${bin} hook post-edit` }],
      },
      {
        matcher: "Shell",
        hooks: [{ type: "command", command: `${bin} hook post-command` }],
      },
    ],
  };
}

export function buildGrokHooksJson(ggBin: string): string {
  return JSON.stringify({ hooks: buildGgHookMatchers(ggBin) }, null, 2);
}

export function writeGrokHooksJson(
  grokHome: string,
  ggBin: string,
  _projectCwd?: string
): void {
  const hooksPath = `${grokHome}/hooks/hooks.json`;

  let existing: GrokHooksFile = { hooks: {} };
  if (existsSync(hooksPath)) {
    try {
      const parsed = JSON.parse(readFileSync(hooksPath, "utf-8"));
      if (parsed && typeof parsed === "object" && parsed.hooks) {
        existing = parsed as GrokHooksFile;
      }
    } catch {}
  }

  const dir = dirname(hooksPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const ggMatchers = buildGgHookMatchers(ggBin);
  const merged: Record<string, GrokHookMatcher[]> = { ...existing.hooks };

  for (const [event, groups] of Object.entries(ggMatchers)) {
    // Preserve any non-GrokGoblin hook groups the user defined for this event, then
    // append GrokGoblin's groups (replacing previously installed GrokGoblin groups).
    const preserved = (merged[event] ?? []).filter((g) => !isGgMatcher(g));
    merged[event] = [...preserved, ...groups];
  }

  writeFileSync(
    hooksPath,
    JSON.stringify({ hooks: merged }, null, 2) + "\n",
    "utf-8"
  );
}

export function removeGgHooks(grokHome: string): void {
  const hooksPath = `${grokHome}/hooks/hooks.json`;
  if (!existsSync(hooksPath)) return;

  try {
    const parsed = JSON.parse(readFileSync(hooksPath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || !parsed.hooks) return;
    const existing = parsed as GrokHooksFile;

    const cleaned: Record<string, GrokHookMatcher[]> = {};
    for (const [event, groups] of Object.entries(existing.hooks)) {
      const remaining = groups.filter((g) => !isGgMatcher(g));
      if (remaining.length > 0) cleaned[event] = remaining;
    }

    writeFileSync(
      hooksPath,
      JSON.stringify({ hooks: cleaned }, null, 2) + "\n",
      "utf-8"
    );
  } catch {}
}

export function upsertAgentsMdBlock(
  agentsMdPath: string,
  generatedContent: string,
  force = false
): "created" | "updated" | "skipped" {
  const dir = dirname(agentsMdPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (!existsSync(agentsMdPath)) {
    writeFileSync(agentsMdPath, generatedContent, "utf-8");
    return "created";
  }

  const existing = readFileSync(agentsMdPath, "utf-8");

  if (existing.includes(GG_AGENTS_MD_START)) {
    const startIdx = existing.indexOf(GG_AGENTS_MD_START);
    const endIdx = existing.indexOf(GG_AGENTS_MD_END);
    if (endIdx === -1) {
      const updated =
        existing.slice(0, startIdx) +
        GG_AGENTS_MD_START +
        "\n" +
        generatedContent +
        "\n" +
        GG_AGENTS_MD_END;
      writeFileSync(agentsMdPath, updated, "utf-8");
      return "updated";
    }
    const updated =
      existing.slice(0, startIdx) +
      GG_AGENTS_MD_START +
      "\n" +
      generatedContent +
      "\n" +
      existing.slice(endIdx);
    writeFileSync(agentsMdPath, updated, "utf-8");
    return "updated";
  }

  if (force) {
    writeFileSync(agentsMdPath, generatedContent, "utf-8");
    return "updated";
  }

  return "skipped";
}
