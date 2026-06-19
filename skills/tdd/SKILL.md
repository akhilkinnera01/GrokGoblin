# /tdd

Test-driven development flow.

## Cycle

TDD in three phases, strictly in order:
1. **Red** — Write a failing test
2. **Green** — Write the minimal code to pass it
3. **Refactor** — Clean up without breaking the test

Don't skip phases. Don't write implementation before the test.

## Protocol

### Setup

```
[TDD START]
Feature: {what we're building}
Test framework: {jest / vitest / pytest / etc.}
Test file: {where tests will live}
```

### Red Phase

Write one test that describes the next increment of behavior.
The test must:
- Be specific (not "it works")
- Fail right now (verify it fails before writing code)
- Test behavior, not implementation

```
[RED] Test: {test name}
Expected: {what the test asserts}
Status: FAILING ✗
```

### Green Phase

Write the minimal code to make the test pass.
Minimum means:
- No more than what the test requires
- No generalizing for future cases
- No cleanup or refactoring yet

```
[GREEN] Implementation: {what was written}
Test status: PASSING ✓
```

### Refactor Phase

Now clean up — but only if tests stay green.
- Remove duplication
- Improve naming
- Extract patterns that appear 3+ times
- No new behavior

```
[REFACTOR] Changes: {what was cleaned up}
Test status: STILL PASSING ✓
```

### Next Increment

Repeat. Each increment should be small enough to complete in one turn.

## Example Flow

```
Increment 1: "returns null for unknown user"
  RED:    test('getUser("unknown") returns null')
  GREEN:  function getUser(id) { return null; }
  REFACTOR: nothing to refactor yet

Increment 2: "returns user data for known user"
  RED:    test('getUser("alice") returns {name:"Alice"}')
  GREEN:  add user lookup logic
  REFACTOR: extract user store constant
```

## Rules

- One test per increment — don't write a test suite before any code
- If a test is hard to write, the design is wrong — fix the design
- Tests are documentation — name them to describe behavior
- Test at the right level (unit/integration/e2e) for what's being verified
- Don't mock what you own — integration tests often catch more bugs than unit tests

## State

`.grokgoblin/state/tdd-state.json`:
```json
{
  "active": true,
  "phase": "red|green|refactor",
  "feature": "...",
  "incrementsCompleted": 3,
  "testFile": "..."
}
```
