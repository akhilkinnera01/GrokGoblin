---
name: ship
description: "Verify-gate then ship. Refuses a failing check, creates a safe branch (never the default branch, never --force), writes a style-matched commit, and optionally pushes / opens a PR with verification evidence. Use when work is done and you want it committed and shipped safely."
---

# /ship

Commit and ship finished work without footguns.

## What it does

1. **Verify gate** — runs the project's check (auto-detected test/build/typecheck,
   or `--verify "<cmd>"`). A red check **refuses to ship**; override only with `--no-verify`.
2. **Safe branch** — never commits straight onto the default branch and never
   force-pushes. If you're on the default branch it moves the work to a `gg/<slug>` branch.
3. **Style-matched commit** — writes a commit message that matches the last ~30
   commits' style. `--split` groups changes into multiple commits by concern.
4. **Optional publish** — `--push` pushes the branch; `--pr` pushes and opens a
   pull request with the verification evidence in the body.

A clean tree that is already ahead of the base ships the existing commits
(push / PR) rather than re-committing.

## When to use

Use `/ship` when the change is done and verified and you want it committed —
and optionally pushed or turned into a PR — without risking the default branch.

## Flags

- `[message]` — explicit commit message (otherwise inferred from the diff)
- `--split` — group changes into multiple commits by concern
- `--push` — push the branch after committing
- `--pr` — push and open a GitHub PR with verification evidence
- `--verify "<cmd>"` — override the auto-detected check
- `--no-verify` — skip the verify gate (use sparingly)
