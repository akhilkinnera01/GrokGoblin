<p align="center">
  <img src="assets/banner.jpg" alt="GrokGoblin — for Grok CLI" width="720">
</p>

<h1 align="center">GrokGoblin <code>(gg)</code></h1>

<p align="center">
  A multi-agent orchestration layer for the <a href="https://x.ai">xAI Grok CLI</a><br>
  <em>structured workflows · real grok subagents · lifecycle hooks · durable autonomous execution</em>
</p>

---

GrokGoblin wraps the `grok` CLI you already use and turns it into an opinionated, repeatable engineering workflow: clarify → plan → execute, with specialist roles, persistent loops, and an autonomous mode that keeps working until the job is done.

It installs natively into grok — skills, hooks, agent roles, and `AGENTS.md` — so everything works inside ordinary `grok` sessions, not a separate runtime.

---

## Requirements

- [grok CLI](https://x.ai) `0.2.x` installed and signed in (`grok login`) — no SuperGrok/paid tier required.
- Node.js `>= 20`.

## Install

```bash
git clone https://github.com/akhilkinnera/grokgoblin
cd grokgoblin
npm install
npm run build
npm install -g .      # provides `gg` and `grokgoblin`
gg setup              # installs skills, hooks, roles & AGENTS.md into ~/.grok
gg doctor             # verify the install
```

> **Heads up:** if you use oh-my-zsh, `gg` is aliased to `git gui citool`. Either remove that alias or use the `grokgoblin` command. GrokGoblin's own hooks always call `grokgoblin` so they can never be shadowed.

## Quickstart

```bash
gg                      # launch grok with the GrokGoblin brain loaded
gg ask "what does this regex do?"      # one-shot question, no repo needed
gg explore "how does auth flow work"   # read-only investigation (cannot edit)
gg cruise "make all tests pass"        # autonomous loop until the goal is done
gg config model fast                   # set the default grok model
```

---

## Commands

### Execution
| Command | Description |
|---|---|
| `gg` | Launch grok interactively with the GrokGoblin orchestration layer. |
| `gg ask <question>` | Quick one-shot question — headless, plain output, no git repo required. |
| `gg explore <topic>` | Read-only investigation, restricted to read/search tools (cannot modify files). |
| `gg autoresearch <topic>` | Multi-facet **read-only** research — fans out parallel `researcher` subagents and synthesizes a structured report (saved to `.grokgoblin/research/`). |
| `gg exec <prompt>` | Run a headless grok task (streaming JSON by default). |
| `gg exec --check` | Verify grok auth end-to-end. |

### Workflows
All three are **autonomous headless loops** — they re-invoke grok across multiple turns and only stop on a verified completion signal (or the iteration cap), so they don't quit after a single turn. Each enforces a **verification gate**: grok may only declare done after it has actually run the build/tests and they pass. Durable per-run state (goal, progress ledger, full log) lives under `.grokgoblin/<kind>/`.

| Command | Description |
|---|---|
| `gg cruise <goal>` | Full pipeline loop: **dig → goblinplan → quest → tdd → code-review**, driven to completion. |
| `gg quest <goal>` | Durable multi-goal loop — decomposes the objective into checkpointed sub-goals and completes them one at a time. |
| `gg ralph <task>` | Persistent single-task completion loop. |
| `gg goblins [N[:role]] <task>` | Orchestrate up to N parallel grok **subagents** ("goblins") on a task (one session, native `Task` tool). Add `--tmux` for the legacy multi-pane interactive mode. |

Common flags: `--max-iterations <n>` (default 8) · `--fast` · `--model <id>` · `--skip-git-repo-check`.

### Memory
GrokGoblin turns on grok's **native cross-session memory** — persistent, queryable project memory (Markdown under `~/.grok/memory/`, indexed in SQLite with hybrid FTS5 keyword + vector search), keyed per project by git remote so clones/worktrees share it. It's auto-injected on the first turn and after compaction, and the agent can recall it mid-session via `memory_search`.

| Command | Description |
|---|---|
| `gg memory` | Show memory status and per-project stores. |
| `gg memory search "<q>"` | Query cross-session memory. |
| `gg memory on` / `off` | Toggle persistence. |
| `gg memory edit` / `clear` | Edit global memory / clear workspace memory. |

### Config & discovery
| Command | Description |
|---|---|
| `gg config` | Show GrokGoblin-managed grok settings. |
| `gg config get/set <key> [val]` | Read/write `config.toml` values (e.g. `models.default`). |
| `gg config model <frontier\|fast>` | Switch the default model. |
| `gg list [skills\|agents\|cruise\|sessions]` | List installed/tracked items. |

### Worktrees (isolated workspaces)
Worktrees let grok work on a task on its own branch without touching your main checkout. GrokGoblin makes them first-class — smart auto-naming, one-command cleanup, and clear isolation messaging — so they're not just a flag you have to remember.

| Command | Description |
|---|---|
| `gg -w` | Launch grok in a **fresh isolated worktree** with an auto-generated goblin name (e.g. `gg/scrappy-6791`). |
| `gg -w feature-x` | Launch in a named worktree (`gg/feature-x`). |
| `gg worktree` | List worktrees with status (clean/dirty/ahead), age, branch and path. |
| `gg worktree new [name]` | Create a worktree (smart name if omitted). |
| `gg worktree rm <name>` | Remove a worktree (`--force` if dirty, `--branch` to also delete the branch). |
| `gg worktree clean` | Prune **merged, clean** worktrees in one go (`--all` for unmerged, `--force` for dirty). |
| `gg worktree path <name>` | Print a worktree's path — `cd "$(gg worktree path <name>)"`. |

Worktrees live in a sibling `…/<repo>.gg-worktrees/<name>` directory (so your main checkout stays clean) and all use the `gg/` branch prefix. Because grok's native memory is keyed by git remote, worktrees **share project memory** with the main checkout.

### Management
| Command | Description |
|---|---|
| `gg setup` | Install skills, hooks, agent roles & `AGENTS.md` into `~/.grok`. |
| `gg doctor` | Diagnose the install and grok integration. |
| `gg skills` · `gg hooks` · `gg agents` | Inspect installed components. |
| `gg update` · `gg uninstall` · `gg version` | Lifecycle. |

### Launch flags
`--fast` (use `grok-composer-2.5-fast`) · `--madmax` (always-approve) · `--plan` (plan mode, headless) · `-w [name]` (isolated git worktree — auto-named if no name given; see [Worktrees](#worktrees-isolated-workspaces)).

---

## How it integrates with grok

GrokGoblin uses grok's own extension points, so there's no separate agent runtime:

- **Goblin subagents** → GrokGoblin's specialist goblins are installed as **real grok subagents** (`config.toml [subagents.roles.*]` + per-role prompt files) and spawned in parallel via grok's `Task` tool. Read-only goblins are capability-locked so they can't modify files. No SuperGrok/paid tier required.

  | Goblin | Specialty | Goblin | Specialty |
  |---|---|---|---|
  | **sniffer** | analyze code & requirements | **nitpick** | code review |
  | **schemer** | planning | **warden** | security review |
  | **tinker** | architecture/design | **forager** | research (read-only) |
  | **basher** | implementation | **prover** | verification/tests |
  | **squasher** | debugging | **grunt** | parallel worker |

- **Skills** → a deliberately small set of `/` commands (no command sprawl): `/goblinplan`, `/dig`, `/cruise`, `/quest`, `/ralph`, `/goblins`, `/code-review`, `/tdd`.
- **Hooks** → installed to `~/.grok/hooks/hooks.json` (Claude-Code schema) and fire on grok's tool/session lifecycle.
- **`AGENTS.md`** → the orchestration brain, appended to grok's system prompt. The per-session dynamic overlay (codebase map, active modes, notepad) is injected straight into `AGENTS.md` at launch and stripped on exit — so it's reliably loaded into the system prompt rather than depending on an async hook grok might never read.
- **Config** → manages real `config.toml` keys (default model, compaction, permissions).

> **Robust state:** workflow state files under `.grokgoblin/state/` are written atomically (temp + rename) and shape-validated on read — a malformed or partial write is quarantined to `*.corrupt` and treated as "no state" instead of crashing the next run.

Inspect roles with `gg agents` or `gg list agents`.

> ⚠️ **Reasoning effort:** the currently available grok models (`grok-build`, `grok-composer-2.5-fast`) don't support a reasoning-effort parameter, so `--high`/`--effort` are accepted but no-op until grok ships an effort-capable model.

---

## Credits

GrokGoblin is **inspired by [oh-my-codex (omx)](https://github.com/Yeachan-Heo/oh-my-codex) by Yeachan Heo**, which I use daily. GrokGoblin reimagines those ideas natively for the grok CLI.

## License

MIT © akhilkinnera01
