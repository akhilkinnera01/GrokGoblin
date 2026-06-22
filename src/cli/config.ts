import { existsSync } from "fs";
import {
  resolveGrokHome,
  resolveGrokConfigPath,
  KNOWN_MODELS,
  DEFAULT_MODEL,
  DEFAULT_FAST_MODEL,
} from "../utils/paths.js";
import {
  readGrokConfig,
  getGrokConfigValue,
  setGrokConfigValue,
} from "../config/generator.js";
import {
  print,
  header,
  ok,
  warn,
  dim,
  bold,
  exitWithError,
} from "../utils/print.js";

// Keys GrokGoblin surfaces as the "managed" grok settings. These are real grok
// config.toml keys (see grok README → Configuration). grok has no `effort`
// config key — reasoning effort is a headless-only flag (`goblin exec --effort`).
const MANAGED_KEYS: Array<{ key: string; desc: string }> = [
  { key: "models.default", desc: "default model for new sessions" },
  { key: "models.web_search", desc: "model used by the web_search tool" },
  { key: "features.support_permission", desc: "prompt before tool execution" },
  { key: "session.auto_compact_threshold_percent", desc: "auto-compact at % of context" },
  { key: "cli.auto_update", desc: "check for updates on launch" },
];

function showConfig(grokHome: string): void {
  const configPath = resolveGrokConfigPath(grokHome);
  header("GrokGoblin-managed grok config");
  print(dim(`File: ${configPath}`));
  if (!existsSync(configPath)) {
    warn("config.toml not found — run `goblin setup`.");
    return;
  }
  readGrokConfig(grokHome); // validates parseability
  print("");
  for (const { key, desc } of MANAGED_KEYS) {
    const value = getGrokConfigValue(grokHome, key);
    const shown = value === undefined ? dim("(unset)") : bold(String(value));
    print(`  ${key.padEnd(38)} ${shown}  ${dim(desc)}`);
  }
  print("");
  print(dim(`Known models: ${KNOWN_MODELS.join(", ")}`));
  print(
    dim("Note: current grok models don't support reasoning effort, so --effort/--high are ignored.")
  );
}

export async function runConfig(
  _cwd: string,
  args: string[]
): Promise<void> {
  const grokHome = resolveGrokHome();
  const sub = args[0];

  if (!sub || sub === "list" || sub === "show") {
    showConfig(grokHome);
    return;
  }

  if (sub === "get") {
    const key = args[1];
    if (!key) exitWithError("usage: goblin config get <key>  (e.g. models.default)");
    const value = getGrokConfigValue(grokHome, key);
    if (value === undefined) {
      warn(`${key} is not set`);
    } else {
      print(String(value));
    }
    return;
  }

  if (sub === "set") {
    const key = args[1];
    const value = args[2];
    if (!key || value === undefined) {
      exitWithError("usage: goblin config set <key> <value>  (e.g. models.default grok-build)");
    }
    if (key === "models.default" && !KNOWN_MODELS.includes(value!)) {
      warn(`'${value}' is not a known grok model (${KNOWN_MODELS.join(", ")}). Setting anyway.`);
    }
    const written = setGrokConfigValue(grokHome, key!, value!);
    ok(`set ${key} = ${written}`);
    return;
  }

  if (sub === "model") {
    // Shortcut: `goblin config model default|fast|<id>`
    const choice = args[1];
    if (!choice) {
      exitWithError(`usage: goblin config model <default|fast|${KNOWN_MODELS.join("|")}>`);
    }
    const model =
      // "frontier" kept as a back-compat alias for "default"
      choice === "default" || choice === "frontier"
        ? DEFAULT_MODEL
        : choice === "fast"
          ? DEFAULT_FAST_MODEL
          : choice!;
    if (!KNOWN_MODELS.includes(model)) {
      warn(`'${model}' is not a known grok model. Setting anyway.`);
    }
    setGrokConfigValue(grokHome, "models.default", model);
    ok(`default model set to ${model}`);
    return;
  }

  exitWithError(
    `unknown config subcommand '${sub}'. Use: list | get <key> | set <key> <value> | model <default|fast>`
  );
}
