import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import type { AgentDefinition } from "../types/index.js";
import { AGENT_DEFINITIONS } from "../agents/definitions.js";
import { resolvePromptsDir, resolveGrokConfigPath } from "../utils/paths.js";
import { readGrokConfig, writeGrokConfig } from "./generator.js";
import { writeTomlFile } from "../utils/toml.js";

// GrokGoblin installs its specialist roles as REAL grok subagent roles
// (`[subagents.roles.<name>]` in config.toml), so the orchestrator can spawn
// them as parallel grok child sessions — not just reference them in AGENTS.md.
// grok role schema: description, default_capability_mode, model, prompt_file.

const ROLE_PREFIX = "gg-"; // prompt-file prefix so we can find/clean our files

function capabilityMode(def: AgentDefinition): string | undefined {
  // grok documents "read-only"; execution roles omit it to inherit full capability.
  return def.tools === "execution" ? undefined : "read-only";
}

function capabilityLine(def: AgentDefinition): string {
  return def.tools === "execution"
    ? "You may read files, edit code, and run commands to complete your task."
    : "Investigate and report only — do NOT modify files or run mutating commands.";
}

export function buildRolePrompt(name: string, def: AgentDefinition): string {
  return [
    `# ${name} (GrokGoblin subagent role)`,
    "",
    def.description,
    "",
    `You are the **${name}** subagent spawned inside a GrokGoblin workflow.`,
    `Posture: ${def.posture}. Routing role: ${def.routingRole}.`,
    "",
    "## Operating guidance",
    `- ${capabilityLine(def)}`,
    "- Stay strictly within your role; defer out-of-scope work back to the orchestrator.",
    "- Be concise and structured — your output is consumed by another agent.",
    "- End with a short, actionable summary of findings or changes.",
  ].join("\n");
}

export function writeSubagentRolePrompts(grokHome: string): number {
  const promptsDir = resolvePromptsDir(grokHome);
  if (!existsSync(promptsDir)) mkdirSync(promptsDir, { recursive: true });
  let count = 0;
  for (const [name, def] of Object.entries(AGENT_DEFINITIONS)) {
    writeFileSync(
      join(promptsDir, `${ROLE_PREFIX}${name}.md`),
      buildRolePrompt(name, def) + "\n",
      "utf-8"
    );
    count++;
  }
  return count;
}

export function buildSubagentRolesConfig(grokHome: string): Record<string, unknown> {
  const promptsDir = resolvePromptsDir(grokHome);
  const roles: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(AGENT_DEFINITIONS)) {
    const role: Record<string, unknown> = {
      description: def.description,
      model: def.model,
      prompt_file: join(promptsDir, `${ROLE_PREFIX}${name}.md`),
    };
    const mode = capabilityMode(def);
    if (mode) role.default_capability_mode = mode;
    roles[name] = role;
  }
  return { subagents: { roles } };
}

// Install roles as real grok subagents: write prompt files + merge config.toml.
export function installSubagentRoles(grokHome: string): number {
  const count = writeSubagentRolePrompts(grokHome);
  writeGrokConfig(grokHome, buildSubagentRolesConfig(grokHome));
  return count;
}

// Remove GrokGoblin roles from config.toml and delete the gg-*.md prompt files.
export function removeSubagentRoles(grokHome: string): void {
  const configPath = resolveGrokConfigPath(grokHome);
  if (existsSync(configPath)) {
    const config = readGrokConfig(grokHome) as Record<string, unknown>;
    const subagents = config.subagents as
      | { roles?: Record<string, unknown> }
      | undefined;
    if (subagents?.roles) {
      for (const name of Object.keys(AGENT_DEFINITIONS)) {
        delete subagents.roles[name];
      }
      if (Object.keys(subagents.roles).length === 0) delete subagents.roles;
      if (Object.keys(subagents).length === 0) delete config.subagents;
      writeTomlFile(configPath, config);
    }
  }
  const promptsDir = resolvePromptsDir(grokHome);
  for (const name of Object.keys(AGENT_DEFINITIONS)) {
    const p = join(promptsDir, `${ROLE_PREFIX}${name}.md`);
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {}
    }
  }
}

// Count how many GrokGoblin roles are currently registered in config.toml.
export function countInstalledRoles(grokHome: string): number {
  const configPath = resolveGrokConfigPath(grokHome);
  if (!existsSync(configPath)) return 0;
  try {
    const config = JSON.parse(
      JSON.stringify(readGrokConfig(grokHome))
    ) as Record<string, unknown>;
    const roles =
      (config.subagents as { roles?: Record<string, unknown> } | undefined)
        ?.roles ?? {};
    return Object.keys(AGENT_DEFINITIONS).filter((n) => n in roles).length;
  } catch {
    return 0;
  }
}
