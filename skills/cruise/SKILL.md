---
name: cruise
description: "Full autonomous pipeline — dig, goblinplan, quest, tdd, code-review in sequence with no manual handoffs. Use when scope is trusted and you want hands-off end-to-end execution."
---

# /cruise

Full autonomous pipeline: **dig → goblinplan → quest → tdd → code-review**.

## Purpose

Cruise runs the complete GrokGoblin pipeline in sequence without manual handoffs.
Use it when you trust the scope and want hands-off execution.

The five stages, in order:

1. **dig** — clarify scope, requirements and explicit non-goals.
2. **goblinplan** — turn the clarified scope into an architecture + step plan.
3. **quest** — execute the plan as discrete, checkpointed goals.
4. **tdd** — cover the work with tests (write/extend, make them pass).
5. **code-review** — self-review for correctness, edge cases and regressions; fix what you find.

For complex or high-risk work, prefer running the stages explicitly:
`/dig` → `/goblinplan` → `/quest` → `/tdd` → `/code-review`

## Protocol

### Phase 1 — dig (rapid clarification)

Ask the 2 most critical clarifying questions (not 5 — this is cruise).
If scope is already crystal clear, skip ahead.

Questions to ask:
1. What does success look like? (mandatory if not obvious)
2. What's explicitly out of scope? (mandatory for non-trivial tasks)

### Phase 2 — goblinplan (fast plan)

Produce a concise plan (not a full goblinplan deep-dive):
- What you'll do (3-5 bullets)
- Key architecture decisions
- Verification approach

State: "Proceeding in 10 seconds. Reply 'stop' to interrupt."

Wait 5 seconds, then continue.

### Phase 3 — quest (execute)

Execute the plan as checkpointed goals, with `/ralph` persistence discipline.
Verify each step as you go.

### Phase 4 — tdd (test) + code-review

Cover the change with tests and run them. Then self-review the diff for
correctness, edge cases and regressions, and fix anything you find.

### Phase 5 — Report

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

`.grokgoblin/state/cruise-state.json`:
```json
{
  "active": true,
  "phase": "clarification|planning|execution|complete",
  "taskDescription": "...",
  "startedAt": "...",
  "iteration": 0
}
```
