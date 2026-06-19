# /cruise

Full autonomous workflow: clarify → plan → execute.

## Purpose

Cruise runs the complete GrokGoblin workflow in sequence without manual handoffs.
Use it when you trust the scope and want hands-off execution.

For complex or high-risk work, prefer explicit handoffs:
`/deep-interview` → `/grokplan` → `/ralph`

## Protocol

### Phase 1 — Rapid Clarification

Ask the 2 most critical clarifying questions (not 5 — this is cruise).
If scope is already crystal clear, skip to Phase 2.

Questions to ask:
1. What does success look like? (mandatory if not obvious)
2. What's explicitly out of scope? (mandatory for non-trivial tasks)

### Phase 2 — Fast Plan

Produce a concise plan (not a full grokplan deep-dive):
- What you'll do (3-5 bullets)
- Key architecture decisions
- Verification approach

State: "Proceeding in 10 seconds. Reply 'stop' to interrupt."

Wait 5 seconds, then continue.

### Phase 3 — Execute

Use `/ralph` discipline. Execute the plan.
Verify each step as you go.

### Phase 4 — Report

```
[CRUISE COMPLETE]
Task: {task}
Done: {what was accomplished}
Evidence: {how to verify}
Artifacts: {files changed, tests added, etc.}
```

## Cruise Rules

1. Never run cruise on destructive operations (data migrations, schema drops, force pushes) without explicit confirmation
2. Stop and ask if you hit an unexpected blocker
3. If confidence drops below 80%, surface your uncertainty before acting
4. Prefer reversible changes — branch first if the change is risky

## State

`.gg/state/cruise-state.json`:
```json
{
  "active": true,
  "phase": "clarification|planning|execution|complete",
  "taskDescription": "...",
  "startedAt": "...",
  "iteration": 0
}
```
