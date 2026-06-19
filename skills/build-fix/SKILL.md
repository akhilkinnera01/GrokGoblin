# /build-fix

Systematic bug diagnosis and minimal fix.

## Philosophy

The right fix is the smallest change that addresses the actual root cause.
Not a refactor. Not a "while I'm here" cleanup. The specific bug, fixed cleanly.

## Protocol

### Phase 1 — Reproduce

Before touching code:
- Understand the exact failure mode (error message, stack trace, unexpected behavior)
- Reproduce it (even in your head if not runnable)
- State your reproduction steps

### Phase 2 — Diagnose

Find the root cause:
```
Symptom: {what the user observed}
Root cause: {the actual underlying issue}
NOT the root cause: {red herrings to rule out}
```

Methods:
- Read the error message carefully — it usually tells you where to look
- Trace the execution path from symptom to source
- Check recent changes (git log/diff) — bugs often appear right after changes
- Look for the simplest explanation first

### Phase 3 — Fix

Write the fix:
- Minimum surface area — change only what's needed
- Don't refactor adjacent code unless it caused the bug
- If the fix requires understanding a second system, document that dependency

### Phase 4 — Verify

After fixing:
```
Fix: {what was changed and why}
Verification: {how I know it's fixed}
Side effects: {what else this change might affect}
Tests added: {yes/no — and why}
```

### Phase 5 — Prevent

If this bug could recur:
- Add a test that would have caught it
- Add a guard/assertion
- Document the invariant that must hold

## Output Format

```
## Build Fix: {issue}

**Root cause**: {diagnosis}
**Fix**: {what changed}
**Files changed**: {list}
**Verification**: {evidence it's fixed}
**Tests added**: {yes/no}
**Regression risk**: {Low/Medium/High — and why}
```

## Rules

- Don't fix symptoms — fix causes
- If you don't understand why it was broken, you can't be sure the fix is right
- One bug fix per PR — don't bundle unrelated changes
- If the fix is "add error handling" that hides the real issue — that's not a fix
