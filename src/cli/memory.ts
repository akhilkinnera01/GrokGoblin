import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { resolveGrokHome } from "../utils/paths.js";
import { readGrokConfig, setGrokConfigValue } from "../config/generator.js";
import { commandExists, spawnGrokHeadless } from "../utils/exec.js";
import {
  print,
  header,
  ok,
  warn,
  info,
  dim,
  bold,
  exitWithError,
} from "../utils/print.js";

function memoryRoot(grokHome: string): string {
  return join(grokHome, "memory");
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isMemoryEnabled(grokHome: string): boolean {
  const cfg = readGrokConfig(grokHome) as { memory?: { enabled?: boolean } };
  return cfg.memory?.enabled === true;
}

function showStatus(grokHome: string): void {
  const root = memoryRoot(grokHome);
  header("GrokGoblin Memory (grok cross-session memory)");
  print(`${dim("enabled:")} ${isMemoryEnabled(grokHome) ? "yes" : bold("no — run `gg memory on`")}`);
  print(`${dim("store:")}   ${root}`);
  print("");

  if (!existsSync(root)) {
    info("No memory written yet. It builds up as you work in grok sessions.");
    return;
  }
  const global = join(root, "MEMORY.md");
  if (existsSync(global)) {
    print(`  ${bold("global")}  MEMORY.md  ${dim(fmtSize(statSync(global).size))}`);
  }
  // Per-workspace memory dirs: <slug>-<hash8>/
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    const mem = join(dir, "MEMORY.md");
    const sessions = join(dir, "sessions");
    const memSize = existsSync(mem) ? fmtSize(statSync(mem).size) : "—";
    const sessCount = existsSync(sessions) ? readdirSync(sessions).length : 0;
    print(`  ${bold(entry)}  MEMORY.md ${dim(memSize)}  ${dim(`${sessCount} session logs`)}`);
  }
  print("");
  print(dim("Search: gg memory search \"<query>\"   ·   Edit global: gg memory edit"));
}

export async function runMemory(cwd: string, args: string[]): Promise<void> {
  const grokHome = resolveGrokHome();
  const sub = args[0];

  if (!sub || sub === "status") {
    showStatus(grokHome);
    return;
  }

  if (sub === "on" || sub === "off") {
    setGrokConfigValue(grokHome, "memory.enabled", sub === "on" ? "true" : "false");
    ok(`cross-session memory ${sub === "on" ? "enabled" : "disabled"} (config.toml [memory])`);
    return;
  }

  if (sub === "path") {
    print(memoryRoot(grokHome));
    return;
  }

  if (sub === "edit") {
    const global = join(memoryRoot(grokHome), "MEMORY.md");
    const editor = process.env["EDITOR"] ?? process.env["VISUAL"] ?? "vi";
    if (!existsSync(global)) {
      warn(`No global memory file yet at ${global}`);
      return;
    }
    spawnSync(editor, [global], { stdio: "inherit" });
    return;
  }

  if (sub === "clear") {
    const grokBin = process.env["GROK_BIN"] ?? "grok";
    // Delegate to grok's own memory clear (workspace by default).
    spawnSync(grokBin, ["memory", "clear"], { stdio: "inherit" });
    return;
  }

  if (sub === "search") {
    const query = args.slice(1).join(" ").trim();
    if (!query) exitWithError('usage: gg memory search "<query>"');
    if (!isMemoryEnabled(grokHome)) {
      warn("memory is disabled — run `gg memory on` first.");
      return;
    }
    const grokBin = process.env["GROK_BIN"] ?? "grok";
    if (!commandExists(grokBin)) exitWithError("grok not found on PATH.");
    header(`Memory search: ${query}`);
    const result = spawnGrokHeadless(
      `Use the memory_search tool to search cross-session memory for: "${query}". List the matching memories concisely with their source. Do not do anything else.`,
      ["--experimental-memory", "--output-format", "plain"],
      { ...process.env, GROK_HOME: grokHome },
      grokBin
    );
    const out = (result.stdout || result.stderr || "").trim();
    print(out || dim("(no results)"));
    return;
  }

  exitWithError(
    `unknown memory subcommand '${sub}'. Use: status | on | off | search <q> | edit | clear | path`
  );
}
