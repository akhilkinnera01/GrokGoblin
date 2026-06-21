<p align="center">
  <img src="assets/banner.jpg" alt="GrokGoblin — for the grok CLI" width="720">
</p>

<h1 align="center">GrokGoblin</h1>

<p align="center">
  <b>Turn the <a href="https://x.ai">xAI grok CLI</a> into an autonomous engineer that doesn't stop until your build is green.</b><br>
  <em>specialist subagents · verified autonomous loops · live web/X grounding · native grok integration</em>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Node v20+" src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white">
  <img alt="grok CLI 0.2.x" src="https://img.shields.io/badge/grok%20CLI-0.2.x-black">
  <img alt="Status: beta" src="https://img.shields.io/badge/status-beta-orange">
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#concepts">Concepts</a> ·
  <a href="#reference">Reference</a> ·
  <a href="#troubleshooting">Troubleshooting</a>
</p>

---

## What is GrokGoblin?

GrokGoblin wraps the `grok` CLI you already use and gives it a repeatable workflow — **clarify → plan → execute → verify** — plus specialist roles and autonomous loops that keep working until the job is actually done.

It installs *natively* into grok (skills, hooks, subagent roles, `AGENTS.md`), so everything runs inside ordinary `grok` sessions. No daemon, no separate model server, no new runtime to learn.

> **The one idea that matters:** when GrokGoblin says "done," it ran your build and tests to prove it — the *harness* runs the check after every round, not the model. A loop can't declare success while the check is red. No tests? An independent reviewer goblin grades the work instead.

---

## Install

**Fastest — no install (npx):**

```bash
npx grokgoblin setup    # installs skills, hooks, roles & AGENTS.md into ~/.grok
npx grokgoblin doctor   # verify (should be all green)
```

**Or install the `goblin` command globally:**

```bash
npm install -g grokgoblin
goblin setup
goblin doctor
```

This gives you two identical commands: **`goblin`** (short) and **`grokgoblin`** (explicit). We deliberately *don't* ship a `gg` command — `gg` collides with the common oh-my-zsh alias for `git gui citool`, so it would be silently shadowed in most shells.

**Requirements:** the [grok CLI](https://x.ai) `0.2.x` (signed in via `grok login`), Node.js `>= 20`. tmux is optional — only for the visual multi-pane modes.

<details>
<summary>From source / bleeding edge</summary>

```bash
git clone https://github.com/akhilkinnera01/GrokGoblin
cd GrokGoblin
npm install            # builds automatically
npm install -g .       # provides `goblin` and `grokgoblin`
goblin setup && goblin doctor
```

Latest unreleased commit: `npx github:akhilkinnera01/GrokGoblin setup`.
</details>

---

## Quickstart

```bash
goblin                                  # launch grok with the GrokGoblin brain loaded
goblin ask "what does this regex do?"   # one-shot question, no repo needed
goblin explore "how does auth work"     # read-only investigation (cannot edit files)
goblin forage "state of Rust web frameworks in 2026" --deep   # deep research, parallel web/X search
goblin ralph "make the failing tests pass"          # autonomous loop until verified
goblin hunt "add a /health endpoint with a test"    # set a goal, pursue until verified
goblin review                           # independent 2-lane code review of your changes
goblin ship --pr                        # verify, commit on a safe branch, open a PR
```

Inside a `grok` session, the same power shows up as slash commands:

```
/dig    clarify scope      /cruise   run the full pipeline
/quest  checkpointed work  /swarm    fan out to parallel goblins
/tdd    test-first flow    /hunt     pursue a goal to verified done
/review 2-lane review      /ship     verified commit on a safe branch
/forage deep research (parallel web/X → reflect → verify → cited report)
```

---

## How it works

GrokGoblin adds three things on top of grok:

1. **A leader + specialist goblins.** Your session is the leader. It delegates bounded work to themed subagents (analyst, planner, debugger, reviewer, …) and synthesizes the results. Read-only goblins physically can't modify files.
2. **Verified autonomous loops.** `ralph`, `quest`, `cruise`, `swarm`, and `hunt` re-invoke grok across turns. After each round the harness runs your build/tests itself — the loop only stops on a *verified* pass or the iteration cap.
3. **grok's real strengths, wired up.** Live web/X grounding with citations, a 512K context window on `grok-build`, fast-model routing, and native cross-session memory — all on by default.

It's **token-aware** by design: loops start on the fast model and only escalate to the frontier model when they stall, verification is a real command (≈0 model tokens), and budgets (`--max-iterations`, `--max-turns`, timeouts) stop a stuck run instead of burning tokens.

---

## Concepts

### The goblins (specialist subagents)

`goblin setup` installs **10 roles** as real grok subagents. Inspect them with `goblin agents list`.

| Goblin | Specialty | | Goblin | Specialty |
|---|---|---|---|---|
| **sniffer** | analyze code & requirements *(read-only)* | | **nitpick** | code review *(read-only)* |
| **schemer** | planning | | **warden** | security review *(read-only)* |
| **tinker** | architecture / design | | **forager** | research *(read-only)* |
| **basher** | implementation | | **prover** | verification / tests |
| **squasher** | debugging | | **grunt** | fast parallel worker |

`goblin swarm` fans a task out across these, then runs the **same verification gate** as the loops, repeating until correct. Add `--tmux` for one real grok process per pane, or `--parallel` for worktree-isolated OS-level parallelism (see [when parallel helps](#parallel-help)).

### Skills (in-session `/` commands)

A small, deliberate set — invoke inside a `grok` session with `/<name>`:

| Skill | Use it to… |
|---|---|
| `/dig` | clarify scope, requirements and explicit non-goals |
| `/goblinplan` | turn clarified scope into an architecture + step plan |
| `/quest` | execute a large task as discrete, checkpointed goals |
| `/ralph` | persistently complete a single task with reflection |
| `/cruise` | run the full pipeline: **dig → goblinplan → quest → tdd → code-review** |
| `/tdd` | test-driven development flow |
| `/swarm` | swarm a task across parallel specialist goblins |
| `/code-review` | comprehensive code / PR review |
| `/review` | independent 2-lane review (nitpicker + warden), severity-rated |
| `/hunt` | set a goal and pursue it autonomously to verified completion |
| `/ship` | verify-gated, style-matched commit on a safe branch |
| `/forage` | deep research: parallel web/X search → reflect → verify → cited report |

### Memory, worktrees & the brain

- **Memory** — GrokGoblin turns on grok's native cross-session memory (Markdown indexed in SQLite with keyword + vector search), keyed per project by git remote so clones and worktrees share it. Every autonomous run also writes a short digest of what it accomplished. Manage it with `goblin memory`.
- **Worktrees** — `goblin -w` launches grok on its own branch without touching your main checkout (smart auto-naming, one-command cleanup). Worktrees share project memory with the main checkout.
- **The brain (`AGENTS.md`)** — setup writes an orchestration brain into `~/.grok/AGENTS.md`, and each launch injects a fresh per-session overlay (codebase map, active modes, memory digest) that's stripped on exit.

---

## Walkthroughs

**Plan, then build** — inside a `grok` session:
```
/dig "add OAuth login"   →   /goblinplan   →   /quest
```

**Hands-off autonomous completion:**
```bash
goblin ralph  "fix the flaky test in auth.test.ts"     # one task, to completion
goblin quest  "migrate the API from v1 to v2"          # multi-goal, checkpointed
goblin cruise "add a /health endpoint with tests"      # full pipeline
goblin hunt   "ship a working rate limiter" --detach   # triages + runs for hours
```
Each loops until completion is **verified** (or it hits the iteration cap). Tune with `--verify "<cmd>"`, `--max-iterations N`, `--max-turns N`, `--best-of 3`, `--fast` / `--model <id>`.

**Deep research (Perplexity/Codex-style):**
```bash
goblin forage "best embedded KV stores for Rust in 2026"            # quick: plan → parallel search → report
goblin forage "is HTMX still gaining traction" --deep --facets 6     # + a reflection round that chases gaps
```
The lead splits your topic into independent sub-questions, runs one **separate** grok searcher per angle **in parallel** — each one not just snippet-skimming but `open_page`-ing 3–5+ full sources to pull exact figures, plus X/real-time search for community signal. In `--deep` mode it iterates: **reflect on the gaps → search again, up to 3 rounds**, then an **independent fact-checker** re-verifies the load-bearing claims against their sources (confirm / correct / drop). The synthesized report carries summary · key findings · **contrarian views & risks** · open questions · sources · a **rerun-inputs** block. Token-aware: searchers run on the fast model; the reasoning steps (planning, reflection, verification, synthesis) run on the frontier model. Hard read-only — it can touch the web and X, never your repo.

**Verified multi-goblin work:**
```bash
goblin swarm 3 "audit this service and fix the security findings"
goblin swarm --parallel 4 "add a unit-test file for each module"   # OS-parallel, worktree-isolated
```

<a id="parallel-help"></a>
> **When `--parallel` actually helps:** only when units are genuinely large or numerous — work a single agent *can't* batch into one pass (e.g. "process these 100 documents"). For ordinary tasks the sequential verified loop is **faster and cheaper**: one agent batches the work in a single call, while parallel pays a planner call + N rate-limited workers (xAI throttles concurrency). Reach for it deliberately, not by default.

**Review & ship:**
```bash
goblin review --staged        # nitpicker + warden, run as separate processes; deterministic verdict
goblin ship --pr              # verify-gate → safe branch → style-matched commit → open a PR
```

---

## Reference

<details id="reference">
<summary><b>Command reference</b></summary>

### Everyday
| Command | Description |
|---|---|
| `goblin` | Launch grok interactively with the GrokGoblin layer. |
| `goblin ask <question>` | One-shot question — headless, no git repo required. |
| `goblin explore <topic>` | Read-only investigation (cannot modify files). |
| `goblin forage <topic>` | **Deep research** — plan → parallel web/X searchers (read full pages) → synthesize a cited report. `--facets N` (breadth), `--deep` (iterate up to 3 reflect→search rounds + an independent fact-check pass). Saved to `.grokgoblin/forage/`. |
| `goblin exec <prompt>` | Run a headless grok task (`--check` to verify auth). |

### Autonomous loops (verification-gated)
| Command | Description |
|---|---|
| `goblin cruise <goal>` | Full pipeline: **dig → goblinplan → quest → tdd → code-review**. |
| `goblin quest <goal>` | Durable multi-goal loop — decomposes into checkpointed sub-goals. |
| `goblin ralph <task>` | Persistent single-task completion loop. |
| `goblin swarm [N[:role]] <task>` | Verified loop: fan out to N goblins, gate until correct (`--parallel`, `--once`, `--tmux`). |
| `goblin hunt "<objective>"` | Triage → pick strategy → pursue until verified. `--detach` runs for hours across sessions. |
| `goblin hunt [status]` · `pause` · `resume` · `clear [id]` | Goal lifecycle. |

### Review & ship
| Command | Description |
|---|---|
| `goblin review [PR#\|range]` | Independent 2-lane review (nitpicker + warden) as separate processes; never self-reviews. `--staged`, `--post`. |
| `goblin ship [message]` | Verify-gate → safe branch (never the default branch / `--force`) → style-matched commit. `--pr`, `--push`, `--split`, `--no-verify`. |

### Manage
| Command | Description |
|---|---|
| `goblin memory [status\|search\|on\|off\|path\|edit]` | Cross-session project memory. |
| `goblin worktree [new\|rm\|clean\|path]` | Manage isolated worktrees. |
| `goblin config [get\|set\|model]` | Read/write managed `config.toml` keys. |
| `goblin list` · `goblin skills` · `goblin agents list` · `goblin state list` | Inspect installed/tracked items. |
| `goblin setup` · `doctor` · `update` · `uninstall` · `version` | Install lifecycle (`--force`, `--scope project`). |

</details>

<details>
<summary><b>Flags reference</b></summary>

**Launch (`goblin …`)**

| Flag | Effect |
|---|---|
| `-w [name]` | Launch in an isolated git worktree (auto-named if no name). |
| `--fast` | Use `grok-composer-2.5-fast`. |
| `--berserk` | Always-approve mode — no permission prompts (alias `--yolo`). |
| `--plan` | Plan mode (headless). |
| `--direct` / `--tmux` | Force direct launch / detached tmux session. |
| `-m, --model <id>` | Use a specific model id. |

**Loops (`cruise` / `quest` / `ralph` / `swarm` / `hunt`)**

| Flag | Effect |
|---|---|
| `--verify "<cmd>"` / `--no-verify` | Set the check explicitly / disable it (otherwise auto-detected). |
| `--max-iterations <n>` | Iteration cap (default 8). |
| `--max-turns <n>` | Bound each iteration. |
| `--best-of <n>` | Run each iteration N ways in parallel, keep the best. |
| `--fast` / `--model <id>` | Pin a model (otherwise tiers fast → frontier on stall). |
| `--skip-git-repo-check` | Run outside a git repo. |

</details>

<details>
<summary><b>Configuration & models</b></summary>

GrokGoblin only manages real `config.toml` keys in `~/.grok` — it never invents settings.

```bash
goblin config                              # show managed settings
goblin config get models.default          # read a value
goblin config set models.default grok-build
goblin config model fast                  # switch to grok-composer-2.5-fast
```

| Model | Role |
|---|---|
| `grok-build` | frontier / leader (default) — **512K** context |
| `grok-composer-2.5-fast` | fast worker for cheap iterations |

A new grok model id passes straight through — no allowlist gates execution, so the wrapper keeps working the day xAI ships a new model.

| Env var | Purpose |
|---|---|
| `XAI_API_KEY` | xAI API key (optional — `grok login` also works). |
| `GROK_HOME` | Override `~/.grok`. |
| `GG_ROOT` | Override the `.grokgoblin/` state dir. |
| `GROK_BIN` | Override the `grok` binary path. |
| `GG_LAUNCH_POLICY` | `direct` \| `tmux` \| `detached-tmux` \| `auto`. |

</details>

<details>
<summary><b>Power features</b></summary>

- **Big context, used well.** `grok-build` gives a **512K** window; loops run with `--compaction-mode segments`, persisting compacted history as grep-able markdown so a long run can recover earlier detail. Combined with native memory, effective recall stretches past any single window.
- **Best-of-N quality.** `--best-of <n>` runs the work N ways in parallel and keeps the best (headless). Spend more compute when correctness matters.
- **Real-time grounding.** GrokGoblin never restricts grok's web tools on its main flows, and the brain tells grok to proactively `web_search` / X-search for current versions and APIs — with citations.
- **Future-model safe.** No model allowlist gates execution, and `--effort` is only sent to models known to support it, so it can never `400` your session.
- **MCP that actually reloads.** grok caches MCP servers in a persistent leader daemon, so config edits are normally ignored until it dies. GrokGoblin fingerprints your effective MCP config and pins each run to a per-config leader socket — change your servers and the next run picks them up; leave them and the warm leader is reused. Opt out with `GG_NO_LEADER_ISOLATION=1`.

> ⚠️ **Reasoning effort:** current grok models don't support a reasoning-effort parameter, so `--high` / `--effort` are accepted but no-op until grok ships an effort-capable model.

</details>

<details>
<summary><b>How it integrates with grok &amp; file layout</b></summary>

No separate agent runtime — GrokGoblin uses grok's own extension points:

- **Subagents** → real grok subagents (`config.toml [subagents.roles.*]` + per-role prompts); `goblin swarm` also passes the roster via `--agents`.
- **Skills** → the `/` commands, installed to `~/.grok/skills/`.
- **Hooks** → `~/.grok/hooks/hooks.json` (Claude-Code schema), firing on grok's tool/session lifecycle.
- **`AGENTS.md`** → the orchestration brain + per-session overlay.
- **Config & memory** → real `config.toml` keys and grok's native memory.

```
your project: .grokgoblin/   (gitignore it — safe to delete)
├── state/  logs/  plans/          active state & logs
├── memory/project.md             cross-session digest
├── forage/                       saved research
├── cruise/ quest/ ralph/         per-run state
├── goals/<id>/goal.json          hunt contracts (durable)
└── quest/<id>/ledger.jsonl       checkpoint ledger

globally: ~/.grok/   (managed by `goblin setup`)
├── AGENTS.md  skills/  prompts/  hooks/  config.toml
├── leaders/                      per-MCP-config sockets
└── memory/                       grok native memory
```

</details>

---

## Troubleshooting

**`goblin` runs `git gui citool` (or something else) instead of GrokGoblin.**
Your shell has `goblin` aliased. Run `unalias goblin`, or just use the `grokgoblin` command — it's identical.

**`goblin doctor` shows failures.**
Run `goblin doctor --verbose` for fix commands. Most issues clear with `goblin setup --force`. Make sure `grok` is on your PATH and you've run `grok login`.

**Does it need a paid grok tier?**
No. Subagents, memory, and hooks all work on the standard grok CLI.

**`--high` / `--effort` seem to do nothing.**
Correct — current grok models don't support reasoning effort. The flags are accepted but skipped so they can never break a session.

**Will it break when xAI releases a new model?**
No. Point at it with `goblin config set models.default <new-id>` — there's no allowlist blocking unknown models.

**The autonomous loop stopped before finishing.**
It hit the iteration cap without a verified completion. Re-run with a higher `--max-iterations`, or check `.grokgoblin/<kind>/<id>/progress.md` to see where it stalled.

---

## Updating & uninstalling

```bash
goblin update       # pull latest + re-run setup
goblin uninstall    # remove hooks, roles & config keys (skills/AGENTS.md kept)
```

---

## Credits

Inspired by the `oh-my-*` developer-tooling ecosystem, including [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) by Yeachan Heo.

## License

MIT © akhilkinnera01
