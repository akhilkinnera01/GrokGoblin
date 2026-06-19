import type { AgentDefinition } from "../types/index.js";
import { DEFAULT_FRONTIER_MODEL, DEFAULT_FAST_MODEL } from "../utils/paths.js";

export const AGENT_DEFINITIONS: Record<string, AgentDefinition> = {
  analyst: {
    name: "analyst",
    description:
      "Deep investigation, evidence gathering, and structured analysis. Use when you need thorough understanding before acting.",
    reasoningEffort: "high",
    model: DEFAULT_FRONTIER_MODEL,
    modelClass: "frontier",
    posture: "deep-worker",
    routingRole: "specialist",
    tools: "read-only",
    category: "domain",
  },
  planner: {
    name: "planner",
    description:
      "Architecture planning, tradeoff analysis, and implementation strategy. Produces planning artifacts, does not implement.",
    reasoningEffort: "high",
    model: DEFAULT_FRONTIER_MODEL,
    modelClass: "frontier",
    posture: "orchestrator",
    routingRole: "leader",
    tools: "analysis",
    category: "build",
  },
  architect: {
    name: "architect",
    description:
      "System design, API contract definition, and structural decisions. Think before touching code.",
    reasoningEffort: "high",
    model: DEFAULT_FRONTIER_MODEL,
    modelClass: "frontier",
    posture: "deep-worker",
    routingRole: "specialist",
    tools: "analysis",
    category: "build",
  },
  executor: {
    name: "executor",
    description:
      "Clean, precise implementation within approved plan scope. No exploration, no scope creep.",
    reasoningEffort: "medium",
    model: DEFAULT_FRONTIER_MODEL,
    modelClass: "frontier",
    posture: "deep-worker",
    routingRole: "executor",
    tools: "execution",
    category: "build",
  },
  debugger: {
    name: "debugger",
    description:
      "Root cause analysis and systematic bug diagnosis. Minimize surface area, fix the actual cause.",
    reasoningEffort: "high",
    model: DEFAULT_FRONTIER_MODEL,
    modelClass: "frontier",
    posture: "deep-worker",
    routingRole: "specialist",
    tools: "execution",
    category: "build",
  },
  reviewer: {
    name: "reviewer",
    description:
      "Critical evaluation of code changes: correctness, security, simplicity, and edge cases.",
    reasoningEffort: "high",
    model: DEFAULT_FRONTIER_MODEL,
    modelClass: "frontier",
    posture: "deep-worker",
    routingRole: "specialist",
    tools: "read-only",
    category: "review",
  },
  "security-reviewer": {
    name: "security-reviewer",
    description:
      "Security-focused code review: OWASP top 10, injection, auth flaws, data exposure.",
    reasoningEffort: "high",
    model: DEFAULT_FRONTIER_MODEL,
    modelClass: "frontier",
    posture: "deep-worker",
    routingRole: "specialist",
    tools: "read-only",
    category: "review",
  },
  researcher: {
    name: "researcher",
    description:
      "Bounded evidence gathering from codebase and external sources. Synthesizes findings into structured output.",
    reasoningEffort: "medium",
    model: DEFAULT_FRONTIER_MODEL,
    modelClass: "frontier",
    posture: "deep-worker",
    routingRole: "specialist",
    tools: "read-only",
    category: "domain",
  },
  verifier: {
    name: "verifier",
    description:
      "Runs tests, validates behavior, and confirms implementation meets plan criteria.",
    reasoningEffort: "medium",
    model: DEFAULT_FRONTIER_MODEL,
    modelClass: "frontier",
    posture: "deep-worker",
    routingRole: "specialist",
    tools: "execution",
    category: "review",
  },
  "team-worker": {
    name: "team-worker",
    description:
      "Parallel execution worker. Focuses on a bounded slice of work and reports upstream.",
    reasoningEffort: "medium",
    model: DEFAULT_FAST_MODEL,
    modelClass: "fast",
    posture: "fast-lane",
    routingRole: "executor",
    tools: "execution",
    category: "coordination",
  },
};

export function getAgentDefinition(name: string): AgentDefinition | null {
  return AGENT_DEFINITIONS[name] ?? null;
}

export function listAgentNames(): string[] {
  return Object.keys(AGENT_DEFINITIONS);
}

export function agentsByCategory(
  category: AgentDefinition["category"]
): AgentDefinition[] {
  return Object.values(AGENT_DEFINITIONS).filter(
    (a) => a.category === category
  );
}
