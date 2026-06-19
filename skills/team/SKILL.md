# /team

Coordinated parallel execution across multiple Grok sessions.

## Purpose

Team mode splits a large task across multiple parallel Grok worker sessions 
in separate tmux panes. Each worker owns a bounded slice of work and reports
evidence back to the leader.

Use team when:
- The work has clearly independent parallel tracks
- Each track is large enough to justify its own session (>20 min of work)
- The integration points between tracks are well-defined

Don't use team for small tasks — the coordination overhead isn't worth it.

## Launch from shell

```bash
gg team 3:executor "fix the failing tests in the auth module"
gg team 2:reviewer "review the PR and security-audit the changes"
gg team status <team-name>
gg team shutdown <team-name>
```

## In-session protocol

When invoked as `/team` inside a grok session, the leader:

### Step 1 — Task Analysis

Analyze the task and determine:
- How many workers are appropriate (1-4 for most tasks)
- What each worker's bounded scope is
- The integration points between workers
- The verification checklist for final integration

### Step 2 — Worker Split

Define worker assignments:
```
Worker 1: {specific scope} — done when: {criteria}
Worker 2: {specific scope} — done when: {criteria}
...
Integration: {how outputs are combined}
```

### Step 3 — Monitoring

Check worker progress with `gg team status <name>`.
Workers run independently — monitor via tmux pane output.

### Step 4 — Integration

When workers complete:
1. Collect evidence from each worker
2. Run integration tests
3. Resolve any conflicts between worker outputs
4. Verify the combined result

## Worker Rules

Each worker should:
- Stay within its assigned scope
- Use `/ralph` discipline for its slice
- Write output evidence to `.gg/state/team/<name>/worker-N-evidence.md`
- Signal completion in the tmux pane output

## Team State

`.gg/state/team/<team-name>/state.json`:
```json
{
  "teamName": "gg-team-abc123",
  "task": "...",
  "workerCount": 3,
  "workers": [
    {"id": 1, "status": "running", "scope": "..."}
  ],
  "status": "running"
}
```

## Limitations

- Requires tmux (install with `brew install tmux`)
- Workers don't communicate — integration is the leader's job
- Best for I/O-bound work (multiple independent file changes)
- Not for work with sequential dependencies (use `/supragoal` instead)
