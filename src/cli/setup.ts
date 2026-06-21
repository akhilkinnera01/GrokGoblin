import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import type { SetupOptions, SetupScope } from "../types/index.js";
import {
  resolveGrokHome,
  resolveGrokHomeForScope,
  resolveSkillsDir,
  resolvePromptsDir,
  resolveHooksDir,
  resolveAgentsMdPath,
  resolveGrokConfigPath,
  packageSkillsDir,
  packagePromptsDir,
  packageDir,
  GG_VERSION,
} from "../utils/paths.js";
import {
  generateAgentsMd,
  generateRuntimeOverlay,
  injectOverlayIntoAgentsMd,
} from "../hooks/agents-overlay.js";
import {
  writeGrokConfig,
  ensureGrokConfigDefaults,
  migrateLegacyGgConfig,
  writeGrokHooksJson,
  upsertAgentsMdBlock,
} from "../config/generator.js";
import { print, ok, warn, fail, step, info, header, dim } from "../utils/print.js";
import { commandExists } from "../utils/exec.js";
import { ensureDir } from "../utils/toml.js";
import { writeFileSync, readFileSync } from "fs";

import { GROKGOBLIN_SKILLS } from "../utils/paths.js";
const BUILTIN_SKILLS = GROKGOBLIN_SKILLS;

function copyDirRecursive(src: string, dest: string): void {
  if (!existsSync(src)) return;
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

export async function runSetup(
  cwd: string,
  options: SetupOptions = {}
): Promise<void> {
  const scope: SetupScope = options.scope ?? "user";
  const force = options.force ?? false;
  const mergeAgents = options.mergeAgents ?? false;
  const subagentsEnabled = options.subagents ?? true;
  const mcpEnabled = options.mcp ?? false;

  const grokHome = resolveGrokHomeForScope(cwd, scope);
  // Hooks are machine-invoked by grok; use the unambiguous `grokgoblin` bin so a
  // shell alias on `goblin` can never shadow them.
  const ggBin = process.env["GG_ENTRY_PATH"] ?? "grokgoblin";

  header(`grokgoblin setup (v${GG_VERSION})`);
  print(dim(`scope: ${scope} → ${grokHome}`));
  print("");

  if (!commandExists("grok")) {
    warn("grok CLI not found on PATH. Install it first:");
    print("  curl -fsSL https://x.ai/cli/install.sh | sh");
    print("");
    warn("Continuing setup — run `goblin doctor` after installing grok.");
    print("");
  }

  step("Creating directories...");
  ensureDir(grokHome);
  ensureDir(resolveSkillsDir(grokHome));
  ensureDir(resolvePromptsDir(grokHome));
  ensureDir(resolveHooksDir(grokHome));

  step("Installing AGENTS.md...");
  const agentsMdPath = resolveAgentsMdPath(grokHome);
  const agentsMdContent = generateAgentsMd();
  const agentsMdResult = upsertAgentsMdBlock(agentsMdPath, agentsMdContent, force);
  if (agentsMdResult === "created") ok("AGENTS.md created");
  else if (agentsMdResult === "updated") ok("AGENTS.md updated");
  else warn("AGENTS.md already exists — skipping (use --force to overwrite)");

  step("Installing skills...");
  const skillsSrc = packageSkillsDir();
  const skillsDest = resolveSkillsDir(grokHome);
  if (existsSync(skillsSrc)) {
    for (const skillName of BUILTIN_SKILLS) {
      const src = join(skillsSrc, skillName);
      const dest = join(skillsDest, skillName);
      if (existsSync(src)) {
        if (!existsSync(dest) || force) {
          copyDirRecursive(src, dest);
          ok(`  skill: ${skillName}`);
        } else {
          dim(`  skill: ${skillName} (already installed)`);
        }
      }
    }
  } else {
    warn("Package skills directory not found. Run `npm install -g grokgoblin` first.");
  }

  step("Installing prompts...");
  const promptsSrc = packagePromptsDir();
  const promptsDest = resolvePromptsDir(grokHome);
  if (existsSync(promptsSrc)) {
    copyDirRecursive(promptsSrc, promptsDest);
    ok("Prompts installed");
  }

  step("Updating config.toml...");
  const configPath = resolveGrokConfigPath(grokHome);
  const migrated = migrateLegacyGgConfig(grokHome);
  ensureGrokConfigDefaults(grokHome);
  // Enable grok's native cross-session memory: persistent, queryable (SQLite
  // FTS5 + vector) project memory, auto-injected on first turn / after compaction.
  writeGrokConfig(grokHome, { memory: { enabled: true } });
  ok(migrated ? "config.toml updated (cleaned legacy keys; memory enabled)" : "config.toml updated (memory enabled)");

  step("Installing grok subagent roles...");
  const { installSubagentRoles } = await import("../config/subagents.js");
  const roleCount = installSubagentRoles(grokHome);
  ok(`${roleCount} subagent roles registered (config.toml [subagents.roles])`);

  step("Installing hooks...");
  writeGrokHooksJson(grokHome, ggBin);
  ok("hooks/hooks.json updated");

  step("Creating .grokgoblin/ state directory...");
  const ggStateDir = join(cwd, ".grokgoblin");
  ensureDir(join(ggStateDir, "state"));
  ensureDir(join(ggStateDir, "logs"));
  ensureDir(join(ggStateDir, "plans"));
  ensureDir(join(ggStateDir, "memory"));
  ok(".grokgoblin/ state directory ready");

  print("");
  ok(`Setup complete! grokgoblin v${GG_VERSION} is ready.`);
  print("");
  print("Next steps:");
  print(`  1. Run ${dim("goblin doctor")} to verify the installation`);
  print(`  2. Run ${dim("goblin exec --check \"Reply with exactly GrokGoblin-OK\"")} to test grok connectivity`);
  print(`  3. Launch with ${dim("gg")} from your project directory`);
  print("");
  print("In a Grok session, start with:");
  print(`  ${dim("/dig")} — clarify scope`);
  print(`  ${dim("/goblinplan")} — create a plan`);
  print(`  ${dim("/ralph")} — persistent completion loop`);
  print("");
  print(dim("GrokGoblin — native multi-agent orchestration for the grok CLI."));
}

export async function runUninstall(cwd: string): Promise<void> {
  const grokHome = resolveGrokHome();

  header("grokgoblin uninstall");
  print("");

  const { migrateLegacyGgConfig, removeGgHooks } = await import(
    "../config/generator.js"
  );

  step("Cleaning GrokGoblin config keys...");
  migrateLegacyGgConfig(grokHome);
  ok("Config cleaned");

  step("Removing GrokGoblin hooks...");
  removeGgHooks(grokHome);
  ok("Hooks removed");

  step("Removing GrokGoblin subagent roles...");
  const { removeSubagentRoles } = await import("../config/subagents.js");
  removeSubagentRoles(grokHome);
  ok("Subagent roles removed");

  print("");
  ok("grokgoblin uninstalled. Run `goblin setup` to reinstall.");
  print(dim("Skills and AGENTS.md were kept — remove manually if needed."));
}
