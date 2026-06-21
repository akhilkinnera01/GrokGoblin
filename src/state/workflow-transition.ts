import type { GgMode } from "../types/index.js";

type TransitionRule = {
  from: GgMode;
  to: GgMode[];
  requires?: string;
};

const TRANSITION_RULES: TransitionRule[] = [
  {
    from: "dig",
    to: ["goblinplan", "research"],
    requires: "scope-confirmed",
  },
  { from: "goblinplan", to: ["cruise", "ralph", "quest", "swarm"] },
  { from: "quest", to: ["ralph", "swarm"] },
  { from: "ralph", to: ["quest", "swarm"] },
  { from: "research", to: ["goblinplan", "ralph"] },
  { from: "cruise", to: ["ralph", "quest"] },
  { from: "swarm", to: ["quest", "ralph"] },
];

const EXCLUSIVE_PAIRS: Array<[GgMode, GgMode]> = [
  ["ralph", "cruise"],
  ["goblinplan", "cruise"],
  ["dig", "quest"],
  ["dig", "swarm"],
];

export function canTransitionTo(
  fromMode: GgMode,
  toMode: GgMode
): { allowed: boolean; reason?: string } {
  const rule = TRANSITION_RULES.find((r) => r.from === fromMode);
  if (!rule) {
    return {
      allowed: true,
    };
  }
  if (!rule.to.includes(toMode)) {
    return {
      allowed: false,
      reason: `Cannot transition from ${fromMode} to ${toMode}. Allowed next modes: ${rule.to.join(", ")}`,
    };
  }
  return { allowed: true };
}

export function checkModeConflict(
  activeModes: GgMode[],
  newMode: GgMode
): { conflict: boolean; conflictingMode?: GgMode } {
  for (const [a, b] of EXCLUSIVE_PAIRS) {
    if (newMode === a && activeModes.includes(b)) {
      return { conflict: true, conflictingMode: b };
    }
    if (newMode === b && activeModes.includes(a)) {
      return { conflict: true, conflictingMode: a };
    }
  }
  return { conflict: false };
}

export function suggestNextMode(currentMode: GgMode): GgMode[] {
  const rule = TRANSITION_RULES.find((r) => r.from === currentMode);
  return rule?.to ?? [];
}

export function isTerminalMode(mode: GgMode): boolean {
  const rule = TRANSITION_RULES.find((r) => r.from === mode);
  return !rule || rule.to.length === 0;
}
