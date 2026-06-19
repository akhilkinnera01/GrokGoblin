import { existsSync, readdirSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import type { HookEventEnvelope, HookDispatchResult } from "../../types/index.js";
import type { DiscoveredHookPlugin } from "./types.js";
import {
  resolveHooksDir,
  resolveHooksLogPath,
  resolveGrokHome,
  resolveGgStateDir,
} from "../../utils/paths.js";
import { appendJsonlLine, ensureDir } from "../../utils/toml.js";

const HOOK_TIMEOUT_MS = parseInt(process.env["GG_HOOK_TIMEOUT_MS"] ?? "8000");

export function discoverHookPlugins(
  cwd: string,
  grokHome: string
): DiscoveredHookPlugin[] {
  const dirs = [
    join(cwd, ".grok", "hooks"),
    join(grokHome, "hooks"),
  ];

  const plugins: DiscoveredHookPlugin[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.name.endsWith(".mjs") && !entry.name.endsWith(".js")) continue;
      plugins.push({
        name: entry.name.replace(/\.(m)?js$/, ""),
        path: join(dir, entry.name),
        events: [],
      });
    }
  }

  return plugins;
}

export function buildHookEvent(
  eventName: string,
  sessionId: string,
  cwd: string,
  context: Record<string, unknown> = {}
): HookEventEnvelope {
  return {
    schemaVersion: "1",
    event: eventName,
    timestamp: new Date().toISOString(),
    sessionId,
    workspaceRoot: cwd,
    source: "gg",
    context,
  };
}

export function dispatchHookEvent(
  envelope: HookEventEnvelope,
  cwd: string,
  grokHome: string
): HookDispatchResult[] {
  const plugins = discoverHookPlugins(cwd, grokHome);
  const results: HookDispatchResult[] = [];
  const logsDir = join(resolveGgStateDir(cwd), "logs");
  ensureDir(logsDir);

  for (const plugin of plugins) {
    const start = Date.now();
    try {
      const result = spawnSync("node", [plugin.path], {
        input: JSON.stringify(envelope),
        encoding: "utf-8",
        timeout: HOOK_TIMEOUT_MS,
        env: {
          ...process.env,
          GROK_HOOK_EVENT: envelope.event,
          GROK_HOOK_NAME: plugin.name,
          GROK_SESSION_ID: envelope.sessionId,
          GROK_WORKSPACE_ROOT: envelope.workspaceRoot,
          GG_SESSION_ID: envelope.sessionId,
        },
      });

      const dispatchResult: HookDispatchResult = {
        pluginPath: plugin.path,
        success: result.status === 0,
        durationMs: Date.now() - start,
        error: result.status !== 0 ? result.stderr?.toString() : undefined,
      };

      results.push(dispatchResult);
    } catch (err) {
      results.push({
        pluginPath: plugin.path,
        success: false,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const logPath = resolveHooksLogPath(cwd);
  appendJsonlLine(logPath, {
    envelope,
    results,
    dispatched_at: new Date().toISOString(),
  });

  return results;
}

export function buildGrokHooksJson(cwd: string): Record<string, string> {
  const ggBin = process.env["GG_ENTRY_PATH"] ?? "gg";
  return {
    "post-edit": `${ggBin} hook post-edit --cwd "${cwd}"`,
    "pre-command": `${ggBin} hook pre-command --cwd "${cwd}"`,
    "post-command": `${ggBin} hook post-command --cwd "${cwd}"`,
    "on-error": `${ggBin} hook on-error --cwd "${cwd}"`,
  };
}

export function mergeGrokHooksJson(
  existing: Record<string, string>,
  additions: Record<string, string>,
  markerPrefix = "# gg:"
): Record<string, string> {
  const result = { ...existing };
  for (const [event, cmd] of Object.entries(additions)) {
    if (
      !result[event] ||
      result[event].startsWith(markerPrefix) ||
      result[event].includes("grokgoblin") ||
      result[event].includes("gg hook")
    ) {
      result[event] = cmd;
    }
  }
  return result;
}
