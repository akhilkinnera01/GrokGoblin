import { existsSync, readdirSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { GG_VERSION, resolveProjectMemoryPath, resolveNotepadPath, resolveGgSessionInstructionsPath } from "../utils/paths.js";
import { listActiveSkills } from "../state/skill-active.js";
import { getActiveModes, readModeState } from "../state/mode-state.js";
import { readFileOrEmpty } from "../utils/toml.js";

const OVERLAY_START = "<!-- GrokGoblin:RUNTIME:START -->";
const OVERLAY_END = "<!-- GrokGoblin:RUNTIME:END -->";

function generateCodebaseMap(cwd: string, maxDepth = 2): string {
  if (!existsSync(cwd)) return "";
  try {
    const lines: string[] = [];
    function walk(dir: string, depth: number, prefix: string): void {
      if (depth > maxDepth) return;
      const entries = readdirSync(dir, { withFileTypes: true }).slice(0, 30);
      for (const entry of entries) {
        if (entry.name.startsWith(".") && depth > 0) continue;
        if (
          ["node_modules", "dist", ".git", "__pycache__", ".next"].includes(entry.name)
        ) continue;
        const icon = entry.isDirectory() ? "📁" : "📄";
        lines.push(`${prefix}${icon} ${entry.name}`);
        if (entry.isDirectory() && depth < maxDepth) {
          walk(join(dir, entry.name), depth + 1, prefix + "  ");
        }
      }
    }
    walk(cwd, 0, "");
    return lines.slice(0, 60).join("\n");
  } catch {
    return "";
  }
}

function formatModeStatus(cwd: string, sessionId?: string): string {
  const active = getActiveModes(cwd, sessionId);
  if (active.length === 0) return "";
  const lines: string[] = [];
  for (const mode of active) {
    const state = readModeState(mode, cwd, sessionId);
    if (!state) continue;
    lines.push(
      `- **${mode}**: phase=${state.currentPhase}, iter=${state.iteration}/${state.maxIterations}, task="${state.taskDescription.slice(0, 60)}"`
    );
  }
  return lines.join("\n");
}

export function generateAgentsMd(): string {
  return `# GrokGoblin Orchestration Brain

You are operating with **grokgoblin (GrokGoblin)** v${GG_VERSION} installed — a workflow enhancement layer for Grok Build CLI.

---

## Core Workflow

1. **Clarify** with \`/deep-interview\` — when scope, requirements, or non-goals are unclear
2. **Plan** with \`/goblinplan\` — turn clarified scope into an architecture + implementation plan
3. **Execute** with \`/ralph\` or \`/supragoal\` — persistent completion with verification

This sequence is the GrokGoblin way. Don't skip clarification when the task is ambiguous.

---

## GrokGoblin Skills

| Skill | Use for |
|-------|---------|
| \`/deep-interview\` | Structured requirements clarification |
| \`/goblinplan\` | Planning + tradeoff synthesis |
| \`/ralph\` | Persistent completion loop with reflection |
| \`/supragoal\` | Durable multi-goal execution with checkpoints |
| \`/cruise\` | Full autonomous workflow (clarify→plan→execute) |
| \`/code-review\` | Comprehensive code/PR review |
| \`/research\` | Bounded evidence gathering |
| \`/build-fix\` | Systematic bug diagnosis and fix |
| \`/tdd\` | Test-driven development flow |
| \`/team\` | Coordinated parallel execution |

---

## Role System

Adopt the specialist role that fits the current task:

- **Analyst** — Deep investigation, evidence gathering, structured analysis
- **Planner** — Architecture decisions, tradeoff analysis. Does not implement.
- **Architect** — System design, API contracts, structural decisions
- **Executor** — Clean implementation within the approved plan. No scope creep.
- **Debugger** — Root cause analysis. Minimize surface area.
- **Reviewer** — Critical evaluation: correctness, security, simplicity
- **Researcher** — Bounded evidence from codebase and external sources

---

## State Directory

GrokGoblin runtime state lives in \`.grokgoblin/\`:
- \`.grokgoblin/state/<mode>-state.json\` — active workflow mode state
- \`.grokgoblin/plans/\` — planning artifacts
- \`.grokgoblin/logs/\` — hooks and session logs
- \`.grokgoblin/memory/project.md\` — persistent project memory
- \`.grokgoblin/notepad.md\` — temporary scratchpad

---

## Planning Discipline

For any non-trivial task:
1. Clarify scope and define non-goals explicitly
2. Document your architecture decision before touching code
3. Get a plan confirmed before implementing
4. Verify implementation meets the plan criteria

---

## Model Routing

- Default: \`grok-build-0.1\` (frontier, 256K context, high reasoning)
- Fast workers: \`grok-code-fast-1\` (speed-optimized for routine tasks)

---

${OVERLAY_START}
${OVERLAY_END}

---

*Powered by [grokgoblin](https://github.com/akhilkinnera/grokgoblin) — inspired by [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) by Yeachan Heo*
`;
}

export function generateRuntimeOverlay(cwd: string, sessionId: string): string {
  const now = new Date().toISOString();
  const activeSkills = listActiveSkills(cwd);
  const modeStatus = formatModeStatus(cwd, sessionId);
  const codebaseMap = generateCodebaseMap(cwd);
  const memory = readFileOrEmpty(resolveProjectMemoryPath(cwd));
  const notepad = readFileOrEmpty(resolveNotepadPath(cwd));

  const parts: string[] = [
    `**Session:** ${sessionId}`,
    `**Time:** ${now}`,
    `**Working directory:** ${cwd}`,
  ];

  if (activeSkills.length > 0) {
    parts.push(`\n**Active skills:** ${activeSkills.join(", ")}`);
  }

  if (modeStatus) {
    parts.push(`\n**Active modes:**\n${modeStatus}`);
  }

  if (codebaseMap) {
    parts.push(`\n**Codebase structure:**\n\`\`\`\n${codebaseMap}\n\`\`\``);
  }

  if (memory) {
    parts.push(`\n**Project memory:**\n${memory}`);
  }

  if (notepad) {
    parts.push(`\n**Notepad:**\n${notepad}`);
  }

  return parts.join("\n");
}

export function injectOverlayIntoAgentsMd(
  agentsMdContent: string,
  overlay: string
): string {
  const start = agentsMdContent.indexOf(OVERLAY_START);
  const end = agentsMdContent.indexOf(OVERLAY_END);

  if (start === -1 || end === -1) {
    return (
      agentsMdContent.trimEnd() +
      `\n\n${OVERLAY_START}\n${overlay}\n${OVERLAY_END}\n`
    );
  }

  return (
    agentsMdContent.slice(0, start + OVERLAY_START.length) +
    "\n" +
    overlay +
    "\n" +
    agentsMdContent.slice(end)
  );
}

export function stripOverlayFromAgentsMd(content: string): string {
  const start = content.indexOf(OVERLAY_START);
  const end = content.indexOf(OVERLAY_END);
  if (start === -1 || end === -1) return content;
  return (
    content.slice(0, start + OVERLAY_START.length) +
    "\n" +
    content.slice(end)
  );
}

export function writeSessionInstructions(
  grokHome: string,
  sessionId: string,
  overlay: string
): string {
  const path = resolveGgSessionInstructionsPath(grokHome, sessionId);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, overlay, "utf-8");
  return path;
}

export function cleanupSessionInstructions(
  grokHome: string,
  sessionId: string
): void {
  const path = resolveGgSessionInstructionsPath(grokHome, sessionId);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {}
  }
}
