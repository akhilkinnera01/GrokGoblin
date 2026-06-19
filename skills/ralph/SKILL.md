# /ralph

Persistent completion loop with reflection and verification.

## Purpose

Ralph is a durable execution mode. Once started, it keeps driving a task to completion — 
reflecting on progress each iteration, adapting the approach, and only stopping when 
the work is genuinely done or explicitly blocked.

Think of Ralph as the "don't give up" mode.

## When to use

- After a plan is approved (from `/goblinplan`)
- When you need to push through a complex multi-step implementation
- When you want verification loops built in
- When the task might span multiple turns and needs continuation logic

## Protocol

Each Ralph iteration follows:

```
[RALPH TURN {n}/{max}]

1. REFLECT: What's the current state? What was done last turn?
2. ASSESS: Is the task done? If yes, verify and close. If blocked, escalate.
3. ACT: Take the next concrete action toward completion.
4. VERIFY: Did the action work? What evidence do I have?
5. PLAN NEXT: What's the next action? Update the checklist.
```

### Starting Ralph

```
[RALPH START]
Task: {task}
Max iterations: 50
Verification criteria: {how to know it's done}

Current state: Starting fresh
Phase: execution
```

### Completion gate (mandatory — verification is not optional)

Ralph may ONLY declare the task complete after it has actually verified the work:
- RUN the project's build, tests, and linters and confirm they PASS (show the command + result).
- If there is no test/build, state explicitly and concretely how completion was verified.
- If verification fails or can't be run, the task is NOT done — keep iterating or escalate as blocked.

Never claim "done" on the basis of having written code alone. Evidence of a passing check is required to close.

### Closing Ralph

When complete:
```
[RALPH COMPLETE]
Outcome: success|failure|blocked
Evidence: {what proves it's done}
Turns used: {n}
```

### If blocked

```
[RALPH BLOCKED]
Reason: {specific blocker}
Needs: {what would unblock it}
Partial work: {what was accomplished}
```

## Iteration cap

Default max: 50 iterations. Ralph warns at 40 and stops at 50 unless you explicitly extend.
Extend with: "ralph extend 20" to add 20 more iterations.

## State

Updates `.grokgoblin/state/ralph-state.json`:
```json
{
  "active": true,
  "iteration": 5,
  "maxIterations": 50,
  "currentPhase": "execution",
  "taskDescription": "...",
  "lastAction": "...",
  "verificationCriteria": "...",
  "blockers": []
}
```

## Rules

- Don't declare done without evidence (tests pass, behavior confirmed, etc.)
- If stuck for 3 iterations in a row, escalate or change approach
- Minimize turn 1 — don't plan excessively, start acting
- Read before writing — understand the existing code before changing it
