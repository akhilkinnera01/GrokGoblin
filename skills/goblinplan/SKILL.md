# /goblinplan

Architecture planning and implementation strategy synthesis.

## When to use

Use `/goblinplan` after clarification (or when scope is already clear) to:
- Turn a confirmed scope into a concrete implementation plan
- Evaluate architectural tradeoffs before touching code
- Produce a planning artifact that can gate execution

**Rule**: `/goblinplan` produces a plan. It does NOT implement. Code changes require an explicit execution phase.

## Protocol

### Phase 1 — Scope Confirmation

State what you understand the task to be. Confirm or correct before proceeding.

### Phase 2 — Investigation

Before proposing anything:
- Read relevant code, configs, and docs
- Understand the current system behavior
- Identify the integration points affected by this change
- Note what already exists that can be reused
- Recall prior decisions from memory (`memory_search`) so the plan stays consistent with past choices

### Phase 2.5 — Real-time grounding (proactive, not reactive)

Grok has live web/X knowledge — USE IT while planning instead of waiting to be asked. Before locking the architecture, proactively `web_search` for:
- the **current** stable versions / APIs of the libraries and frameworks involved (don't plan against stale APIs)
- recent best practices, known pitfalls, security advisories, or deprecations for the approach you're considering
- for anything fast-moving (model APIs, SDKs, tooling), prefer **today's** sources over training memory

Fold findings into the decisions below and cite them. If a library/API changed recently, the plan must reflect current reality.

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

Writes plan to `.grokgoblin/plans/goblinplan-<timestamp>.md`

## State

Updates `.grokgoblin/state/goblinplan-state.json`:
```json
{
  "active": true,
  "phase": "investigation|planning|approved",
  "planPath": ".grokgoblin/plans/goblinplan-1234.md",
  "approvedAt": null
}
```
