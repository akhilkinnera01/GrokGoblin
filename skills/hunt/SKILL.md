---
name: hunt
description: "Set an objective and pursue it autonomously to verified completion. Use to hand off a goal and have it run without babysitting — triages, picks a strategy, persists a durable contract, and loops with self-correction and verification until done or the budget runs out."
---

# /hunt

Set a goal and pursue it autonomously to verified completion.

## When to use

Use `/hunt` when you want to hand off an objective and have it run to completion
without babysitting it. Hunt triages the goal, picks the right strategy, persists
a durable contract, and pursues it — looping, self-correcting, and verifying until
done or the budget runs out.

Use it for:
- Any non-trivial task where you want autonomous execution
- Goals that might take many iterations (bug fixes, refactors, migrations, new features)
- Long-running work you want to detach and check back on later

## Protocol

### Step 1 — Capture the objective

If the user invoked `/hunt` with a goal inline (e.g. `/hunt migrate config to zod`),
use that as the objective directly.

If invoked bare (`/hunt`), ask ONE question:
> "What's the objective? Be specific about what done looks like."

Do NOT ask multiple questions. One clear objective is enough — hunt's triage handles
the rest.

### Step 2 — Confirm and launch

Echo back the objective in one sentence to confirm understanding, then run:

```bash
gg hunt "<objective>"
```

For goals that are clearly long-running (migrations, large refactors, multi-file
changes), add `--detach` so the hunt survives if the session ends:

```bash
gg hunt --detach "<objective>"
```

Run this with the bash tool. Stream the output so the user can see the triage
result and strategy choice in real time.

### Step 3 — Report back

After the command returns, summarize:
- The strategy hunt chose (exec / ralph / quest / cruise / goblins-parallel)
- The verify command it will use (or "independent QC reviewer" if none)
- The contract id (for `gg hunt resume <id>` if needed)
- Whether it completed, is still running (detached), or was blocked

If blocked or incomplete, suggest: `gg hunt resume <id>` or re-run with
`--max-iterations N` for a higher budget.

## Lifecycle commands

Tell the user about these when relevant:

```bash
gg hunt                    # list all hunts and their status
gg hunt pause [id]         # pause at the next safe boundary
gg hunt resume [id]        # resume a paused or blocked hunt
gg hunt clear [id]         # delete the contract
```

## Flags the user can pass inline

If the user's message includes any of these, pass them through to `gg hunt`:

| Flag | When to use |
|---|---|
| `--detach` | Long-running task; let it run after the session ends |
| `--relentless` | Keep going past the stall threshold |
| `--max-iterations N` | Higher budget (default is 30) |
| `--model <id>` | Pin a specific grok model |

Example: `/hunt --detach "refactor the auth module"` → run `gg hunt --detach "refactor the auth module"`.

## Rules

- Never paraphrase the objective into the shell command — use the user's words verbatim (or the confirmed version) so the contract captures the real goal.
- Do not run any implementation work yourself before launching hunt. Hunt's triage decides the strategy; don't pre-empt it.
- If `gg hunt` is not found on PATH, tell the user to run `gg setup` first.
