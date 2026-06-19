# /deep-interview

Structured requirements clarification before implementing anything complex.

## When to use

Use `/deep-interview` when:
- Requirements are ambiguous, incomplete, or have multiple valid interpretations
- Non-goals need to be explicitly defined to prevent scope creep
- Stakeholder intent is unclear
- You're unsure which of several approaches to take

Don't use it for clearly-scoped one-liners. Use it when the cost of wrong assumptions is high.

## Protocol

### Phase 1 — Intent Mining (ask exactly 5 questions)

Ask focused questions about:
1. **Success criteria** — What does done look like? What would you show someone to prove it's complete?
2. **Non-goals** — What is explicitly out of scope for this change?
3. **Constraints** — What's the binding constraint? (time / backward compat / performance / existing API surface)
4. **Context** — Who uses this? What do they care most about?
5. **Prior art** — What has been tried, rejected, or is known not to work?

One question at a time. Wait for answers. Don't ask all 5 at once.

### Phase 2 — Synthesis

After gathering answers, produce a structured summary:

```
SCOPE: [one sentence]
SUCCESS: [measurable criteria — testable if possible]
NON-GOALS: [explicit bulleted list]
CONSTRAINTS: [ordered by priority]
RECOMMENDED APPROACH: [with rationale]
RISKS: [top 1-2 risks with mitigations]
```

### Phase 3 — Handoff

End with: "Scope confirmed. Ready to move to `/goblinplan` with this scope."

## State

Writes to `.gg/state/deep-interview-state.json`:
```json
{
  "active": true,
  "phase": "intent-mining|synthesis|complete",
  "questionsAsked": 0,
  "scopeConfirmed": false,
  "findings": {}
}
```

## Rules

- Never skip directly to implementation from deep-interview
- If the user says "just do it" — acknowledge, then ask the 1-2 most critical questions anyway
- If scope is already clear (e.g., "fix the typo in README"), say so and skip to action
