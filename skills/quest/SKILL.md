---
name: quest
description: "Durable multi-goal execution with ledger checkpoints. Use for work too large for a single ralph run — breaks it into checkpointed goals and works through them sequentially so progress is never lost."
---

# /quest

Durable multi-goal execution with ledger checkpoints.

## Purpose

Quest breaks a large task into a sequence of discrete, checkpointed goals. 
Each goal is a verifiable unit of work. Grok works through them sequentially, 
logging completion evidence to a ledger so progress is never lost.

Use quest when:
- The task is too large for a single `/ralph` run
- You need to pause and resume across sessions
- You want auditable checkpoint evidence
- The work spans multiple subsystems or phases

## Protocol

### Setup

```
[QUEST SETUP]
Task: {overall task}
Goals:
  G001: {first goal} — criteria: {how to verify}
  G002: {second goal} — criteria: {how to verify}
  G003: ...

Ledger: .grokgoblin/quest/ledger.jsonl
```

### Per-Goal Execution

For each goal Gxxx:
1. State the goal clearly
2. Execute it using `/ralph` discipline (reflect → act → verify)
3. Write checkpoint evidence to ledger
4. Only advance to G(n+1) when Gn is verified complete

### Ledger Entry Format

```jsonl
{"goal":"G001","status":"complete","evidence":"Tests pass: npm test","completed_at":"...","turn":12}
```

### Completion

```
[QUEST COMPLETE]
Goals completed: {n}/{total}
Total evidence: {summary}
Ledger: .grokgoblin/quest/ledger.jsonl
```

## Files

```
.grokgoblin/quest/
├── brief.md          — Original task brief
├── goals.json        — Structured goal list with criteria
├── ledger.jsonl      — Checkpoint evidence per goal
└── quality-gate.json — Final quality verification results
```

## Rules

- Never mark a goal complete without written evidence
- If a goal is blocked, write it to the ledger as "blocked" with reason
- Don't modify previous ledger entries — append only
- Goals are ordered — don't skip ahead without justification

## State

`.grokgoblin/state/quest-state.json`:
```json
{
  "active": true,
  "currentGoal": "G002",
  "totalGoals": 5,
  "completedGoals": 1,
  "phase": "execution",
  "ledgerPath": ".grokgoblin/quest/ledger.jsonl"
}
```
