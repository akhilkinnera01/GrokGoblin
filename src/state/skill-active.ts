import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { SkillActiveState, GgMode } from "../types/index.js";
import { resolveSkillActivePath } from "../utils/paths.js";
import { readJsonFile, writeJsonFile } from "../utils/toml.js";

function readSkillState(cwd: string): SkillActiveState {
  return readJsonFile<SkillActiveState>(resolveSkillActivePath(cwd)) ?? {};
}

function writeSkillState(state: SkillActiveState, cwd: string): void {
  const path = resolveSkillActivePath(cwd);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeJsonFile(path, state);
}

export function activateSkill(
  skillName: string,
  cwd: string,
  sessionId: string,
  mode?: GgMode
): void {
  const state = readSkillState(cwd);
  state[skillName] = {
    mode,
    active: true,
    lastActivatedAt: new Date().toISOString(),
    sessionId,
  };
  writeSkillState(state, cwd);
}

export function deactivateSkill(skillName: string, cwd: string): void {
  const state = readSkillState(cwd);
  if (state[skillName]) {
    state[skillName].active = false;
  }
  writeSkillState(state, cwd);
}

export function listActiveSkills(cwd: string): string[] {
  const state = readSkillState(cwd);
  return Object.entries(state)
    .filter(([, v]) => v.active)
    .map(([k]) => k);
}

export function isSkillActive(skillName: string, cwd: string): boolean {
  const state = readSkillState(cwd);
  return state[skillName]?.active === true;
}
