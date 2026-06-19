import type { HookEventEnvelope } from "../../types/index.js";

export interface HookPluginResult {
  success: boolean;
  message?: string;
  action?: "block" | "allow" | "notify";
  data?: Record<string, unknown>;
}

export interface HookPluginContext {
  event: HookEventEnvelope;
  pluginRoot: string;
  pluginDataDir: string;
  workspaceRoot: string;
}

export interface HookPluginSdk {
  tmux: {
    sendKeys(options: {
      paneId?: string;
      sessionName?: string;
      text: string;
      submit?: boolean;
    }): { success: boolean; error?: string };
  };
  log: {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
  state: {
    read<T>(key: string, fallback?: T): T | undefined;
    write(key: string, value: unknown): void;
    delete(key: string): void;
    all<T>(): Record<string, T>;
  };
  grok: {
    sessionId(): string;
    workspaceRoot(): string;
    activeMode(): string | null;
  };
}

export interface HookPlugin {
  name: string;
  events: string[];
  run(
    context: HookPluginContext,
    sdk: HookPluginSdk
  ): Promise<HookPluginResult>;
}

export interface DiscoveredHookPlugin {
  name: string;
  path: string;
  events: string[];
}
