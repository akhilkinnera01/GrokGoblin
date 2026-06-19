# /grokplan

Architecture planning and implementation strategy synthesis.

## When to use

Use `/grokplan` after clarification (or when scope is already clear) to:
- Turn a confirmed scope into a concrete implementation plan
- Evaluate architectural tradeoffs before touching code
- Produce a planning artifact that can gate execution

**Rule**: `/grokplan` produces a plan. It does NOT implement. Code changes require an explicit execution phase.

## Protocol

### Phase 1 — Scope Confirmation

State what you understand the task to be. Confirm or correct before proceeding.

### Phase 2 — Investigation

Before proposing anything:
- Read relevant code, configs, and docs
- Understand the current system behavior
- Identify the integration points affected by this change
- Note what already exists that can be reused

### Phase 3 — Architecture Decision

For each significant design choice, write an ADR-style entry:
```
DECISION: [what you're choosing]
CONTEXT: [why this choice exists]
OPTIONS: [A] ... [B] ...
CHOSEN: [A/B] because [reason]
TRADEOFFS: [what you're giving up]
```

### Phase 4 — Implementation Plan

Produce a numbered, checkboxed plan:
```
## Implementation Plan: [task name]

### Prerequisites
- [ ] [what must be true before starting]

### Steps
1. [ ] [first concrete action]
2. [ ] [second concrete action]
...

### Verification
- [ ] [how to know it's working]
- [ ] [edge cases to check]

### Rollback
- [how to undo if it goes wrong]
```

### Phase 5 — Approval Gate

End with:
```
Plan ready. Review above and confirm with:
- "approved" — proceed to /ralph or /supragoal
- "revise: [feedback]" — I'll update the plan
```

## Artifacts

Writes plan to `.gg/plans/grokplan-<timestamp>.md`

## State

Updates `.gg/state/grokplan-state.json`:
```json
{
  "active": true,
  "phase": "investigation|planning|approved",
  "planPath": ".gg/plans/grokplan-1234.md",
  "approvedAt": null
}
```
