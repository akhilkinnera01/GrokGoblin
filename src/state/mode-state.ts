import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { ModeState, GgMode } from "../types/index.js";
import { resolveModeStatePath, ggSessionId } from "../utils/paths.js";
import { readJsonFile, writeJsonFile } from "../utils/toml.js";

export function readModeState(
  mode: GgMode,
  cwd: string,
  sessionId?: string
): ModeState | null {
  const statePath = resolveModeStatePath(mode, cwd, sessionId);
  return readJsonFile<ModeState>(statePath);
}

export function writeModeState(
  state: ModeState,
  cwd: string,
  sessionId?: string
): void {
  const statePath = resolveModeStatePath(state.mode, cwd, sessionId);
  const dir = dirname(statePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeJsonFile(statePath, state);
}

export function startMode(
  mode: GgMode,
  taskDescription: string,
  cwd: string,
  sessionId?: string,
  maxIterations = 50,
  extraFields: Partial<ModeState> = {}
): ModeState {
  const sid = sessionId ?? ggSessionId();
  const now = new Date().toISOString();
  const state: ModeState = {
    active: true,
    mode,
    iteration: 0,
    maxIterations,
    currentPhase: "start",
    taskDescription,
    startedAt: now,
    lastTurnAt: now,
    ownerSessionId: sid,
    ...extraFields,
  };
  writeModeState(state, cwd, sid);
  return state;
}

export function updateModeState(
  mode: GgMode,
  updates: Partial<ModeState>,
  cwd: string,
  sessionId?: string
): ModeState | null {
  const existing = readModeState(mode, cwd, sessionId);
  if (!existing) return null;
  const updated: ModeState = {
    ...existing,
    ...updates,
    lastTurnAt: new Date().toISOString(),
  };
  writeModeState(updated, cwd, sessionId);
  return updated;
}

export function endMode(
  mode: GgMode,
  outcome: ModeState["runOutcome"],
  cwd: string,
  sessionId?: string
): void {
  const existing = readModeState(mode, cwd, sessionId);
  if (!existing) return;
  writeModeState(
    {
      ...existing,
      active: false,
      completedAt: new Date().toISOString(),
      runOutcome: outcome,
    },
    cwd,
    sessionId
  );
}

export function getActiveModes(cwd: string, sessionId?: string): GgMode[] {
  const modes: GgMode[] = [
    "ralph",
    "cruise",
    "goblinplan",
    "dig",
    "quest",
    "research",
    "team",
  ];
  return modes.filter((m) => {
    const state = readModeState(m, cwd, sessionId);
    return state?.active === true;
  });
}
