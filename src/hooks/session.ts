import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";
import type { SessionState } from "../types/index.js";
import {
  resolveSessionStatePath,
  resolveGgStateDir,
} from "../utils/paths.js";
import { readJsonFile, writeJsonFile } from "../utils/toml.js";

export function generateSessionId(): string {
  return `gg-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function createSessionState(
  cwd: string,
  sessionId: string,
  extra: Partial<SessionState> = {}
): SessionState {
  const state: SessionState = {
    sessionId,
    startedAt: new Date().toISOString(),
    cwd,
    pid: process.pid,
    platform: process.platform,
    ...extra,
  };
  persistSessionState(state, cwd);
  return state;
}

export function persistSessionState(
  state: SessionState,
  cwd: string
): void {
  const path = resolveSessionStatePath(cwd, state.sessionId);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeJsonFile(path, state);
}

export function readSessionState(
  cwd: string,
  sessionId: string
): SessionState | null {
  return readJsonFile<SessionState>(resolveSessionStatePath(cwd, sessionId));
}

export function isSessionStale(state: SessionState): boolean {
  try {
    process.kill(state.pid, 0);
    return false;
  } catch {
    return true;
  }
}

export function cleanupOldSessions(cwd: string): void {
  const stateDir = resolveGgStateDir(cwd);
  if (!existsSync(stateDir)) return;
}
