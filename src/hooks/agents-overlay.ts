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

1. **Clarify** with \`/dig\` — when scope, requirements, or non-goals are unclear
2. **Plan** with \`/goblinplan\` — turn clarified scope into an architecture + implementation plan
3. **Execute** with \`/ralph\` or \`/quest\` — persistent completion with verification

This sequence is the GrokGoblin way. Don't skip clarification when the task is ambiguous.

---

## GrokGoblin Skills

| Skill | Use for |
|-------|---------|
| \`/dig\` | Structured requirements clarification |
| \`/goblinplan\` | Planning + tradeoff synthesis |
| \`/ralph\` | Persistent completion loop with reflection |
| \`/quest\` | Durable multi-goal execution with checkpoints |
| \`/cruise\` | Full pipeline: dig→goblinplan→quest→tdd→code-review |
| \`/code-review\` | Comprehensive code/PR review |
| \`/tdd\` | Test-driven development flow |
| \`/swarm\` | Coordinated parallel execution across multiple goblins |
| \`/hunt\` | Set a goal and pursue it autonomously to verified completion |
| \`/review\` | Independent 2-lane review (nitpicker + warden), severity-rated |
| \`/ship\` | Verify-gated, style-matched commit on a safe branch |
| \`/forage\` | Deep research: parallel web/X search → reflect → verify → cited report |

---

## State Directory

GrokGoblin runtime state lives in \`.grokgoblin/\`:
- \`.grokgoblin/state/<mode>-state.json\` — active workflow mode state
- \`.grokgoblin/plans/\` — planning artifacts
- \`.grokgoblin/logs/\` — hooks and session logs
- \`.grokgoblin/notepad.md\` — temporary scratchpad

(Cross-session project memory is grok-native, stored under \`~/.grok/memory/\` — see the Memory section above.)

---

## Planning Discipline

For any non-trivial task:
1. Clarify scope and define non-goals explicitly
2. Document your architecture decision before touching code
3. Get a plan confirmed before implementing
4. Verify implementation meets the plan criteria

---

## Your goblins (delegate via the \`spawn_subagent\` tool, alias \`task\`)

Spawn specialist subagents in parallel for independent work. Read-only goblins cannot edit files.

- **sniffer** — analyze code & requirements (read-only)
- **schemer** — planning · **tinker** — architecture/design
- **basher** — implementation · **squasher** — debugging
- **nitpick** — code review (read-only) · **warden** — security review (read-only)
- **forager** — research (read-only) · **prover** — verification/tests
- **grunt** — parallel worker

Prefer delegating broad investigation and parallelizable work to goblins; keep the leader focused on synthesis and decisions.

## Memory (persistent, cross-session)

Cross-session project memory is ON. At the start of non-trivial work, \`memory_search\` for prior decisions, conventions, and gotchas before changing direction — don't relearn what's already known. Memory is captured automatically; surface anything durable (architecture decisions, conventions, sharp edges) in your summaries so it persists.

## Verification is not optional

Never report a task done on the basis of having written code. Before claiming completion, RUN the build/tests/linters and confirm they pass (show the command + result). If none exist, state concretely how you verified. If verification fails, keep going — do not declare success.

## Use grok's strengths

- **Real-time web/X:** proactively \`web_search\` for current library versions, APIs, and best practices while planning — prefer today's sources over training memory for anything fast-moving. Don't wait to be asked.
- **Speed:** route routine/parallel work to the fast model and goblins; use the default model when you need its 512K context.
- Be decisive and direct; bias to action within the verification guardrails above.

## Model Routing

- Default / leader: \`grok-build\` — 512K context, native web/X search
- Fast workers: \`grok-composer-2.5-fast\` — low-latency, 200K context; no native backend search but invokes the web/X search tools fine

---

${OVERLAY_START}
${OVERLAY_END}

---

*Powered by [GrokGoblin](https://github.com/akhilkinnera01/grokgoblin) — native multi-agent orchestration for the grok CLI.*
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

// True if the current overlay region belongs to this session (contains its id).
// Used so a session only strips its OWN overlay on exit and never wipes the
// overlay of another concurrently-running session.
export function overlayRegionIncludes(content: string, needle: string): boolean {
  const start = content.indexOf(OVERLAY_START);
  const end = content.indexOf(OVERLAY_END);
  if (start === -1 || end === -1) return false;
  return content.slice(start, end).includes(needle);
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
