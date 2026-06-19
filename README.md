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
| Command | Description |
|---|---|
| `gg cruise <goal>` | **Autonomous loop** — re-invokes grok until it reports the goal complete, with durable state in `.grokgoblin/cruise/`. |
| `gg supragoal <goal>` | Durable multi-goal decomposition workflow. |
| `gg ralph <task>` | Persistent completion loop for a single task. |
| `gg team [N[:role]] <task>` | Orchestrate up to N parallel grok **subagents** on a task (one session, native `Task` tool). Add `--tmux` for the legacy multi-pane interactive mode. |

### Config & discovery
| Command | Description |
|---|---|
| `gg config` | Show GrokGoblin-managed grok settings. |
| `gg config get/set <key> [val]` | Read/write `config.toml` values (e.g. `models.default`). |
| `gg config model <frontier\|fast>` | Switch the default model. |
| `gg list [skills\|agents\|cruise\|sessions]` | List installed/tracked items. |

### Management
| Command | Description |
|---|---|
| `gg setup` | Install skills, hooks, agent roles & `AGENTS.md` into `~/.grok`. |
| `gg doctor` | Diagnose the install and grok integration. |
| `gg skills` · `gg hooks` · `gg agents` | Inspect installed components. |
| `gg update` · `gg uninstall` · `gg version` | Lifecycle. |

### Launch flags
`--fast` (use `grok-composer-2.5-fast`) · `--madmax` (always-approve) · `--plan` (plan mode, headless) · `-w <branch>` (git worktree).

---

## How it integrates with grok

GrokGoblin uses grok's own extension points, so there's no separate agent runtime:

- **Subagent roles** → GrokGoblin's specialist roles (analyst, planner, architect, executor, debugger, reviewer, security-reviewer, researcher, verifier, team-worker) are installed as **real grok subagents** (`config.toml [subagents.roles.*]` + per-role prompt files). The orchestrator spawns them as parallel grok child sessions via grok's `Task` tool — read-only roles are capability-locked so they can't modify files. No SuperGrok/paid tier required.
- **Skills** → installed to `~/.grok/skills/` and invoked as `/cruise`, `/supragoal`, `/ralph`, `/deep-interview`, etc.
- **Hooks** → installed to `~/.grok/hooks/hooks.json` (Claude-Code schema) and fire on grok's tool/session lifecycle.
- **`AGENTS.md`** → the orchestration brain, appended to grok's system prompt.
- **Config** → manages real `config.toml` keys (default model, compaction, permissions).

Inspect roles with `gg agents` or `gg list agents`.

> ⚠️ **Reasoning effort:** the currently available grok models (`grok-build`, `grok-composer-2.5-fast`) don't support a reasoning-effort parameter, so `--high`/`--effort` are accepted but no-op until grok ships an effort-capable model.

---

## Credits

GrokGoblin is **inspired by [oh-my-codex (omx)](https://github.com/Yeachan-Heo/oh-my-codex) by Yeachan Heo**, which I use daily. GrokGoblin reimagines those ideas natively for the grok CLI.

## License

MIT © akhilkinnera01
