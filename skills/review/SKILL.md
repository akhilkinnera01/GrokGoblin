---
name: review
description: "Independent two-lane code review. A nitpicker (severity-rated correctness/security) and a warden (design adversary) run as separate grok processes and never self-review. Use to review the working tree, --staged changes, a commit range, or a GitHub PR before merging; --post publishes the review to the PR."
---

# /review

Independent, adversarial code review with a deterministic verdict.

## What it does

Two lanes run in parallel as **separate grok processes** so the review is never
the same model grading its own work:

- **nitpicker** — correctness, edge cases, and security, each finding severity-rated.
- **warden** — design adversary: API shape, coupling, and whether the change earns its complexity.

The verdict is synthesized deterministically (no third model "deciding"):

- warden **BLOCK** or nitpicker **REQUEST_CHANGES** → `REQUEST_CHANGES`
- warden **WATCH** or nitpicker **COMMENT** → `COMMENT`
- both clean → `APPROVE`
- either lane missing → `UNAVAILABLE` (never silently approves)

Honors `AGENTS.md` guidelines when present.

## When to use

Use `/review` before merging or shipping — on the working tree, staged changes,
a commit range, or a pull request.

## Targets & flags

- `gg review` — everything uncommitted (working tree + staged) vs HEAD
- `gg review --staged` — staged changes only
- `gg review <range>` — a commit range (e.g. `main..HEAD`)
- `gg review <PR#|url>` — a GitHub pull request
- `--post` — publish the review to the PR (PR targets only)
