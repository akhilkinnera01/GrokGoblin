---
name: forage
description: "Deep research from the terminal: plans angles, runs parallel web + X searchers, reflects on gaps and searches again, fact-checks claims against sources, then writes one cited report. Use for intensive, multi-source synthesis of a complex topic — not quick lookups or top-N lists."
---

# /forage

Intensive, cited deep research with a live web + X-feed edge.

## What it does

Runs `goblin forage "<topic>"`, a hardcoded pipeline (each phase is a real,
read-only `grok -p` process — nothing can write, edit, or run shell):

1. **Plan** (frontier model) — decompose the topic into independent angles,
   including one for real-time / community signal.
2. **Search** (parallel, fast model) — each searcher does `web_search`, opens
   and READS 3–5+ full sources, and pulls X/real-time signal. Cross-checks claims.
3. **Reflect → search again** (`--deep`) — the frontier model names the gaps and
   contradictions; a second/third round chases them. Stops early when coverage is solid.
4. **Verify** (`--deep`, frontier) — an independent fact-checker re-checks key
   claims against their sources (✅ confirm / ⚠️ correct / ❌ drop).
5. **Synthesize** (frontier) — one cited report: summary, key findings,
   contrarian views & risks, open questions, sources, and a rerun-inputs block.

The report is saved to `.grokgoblin/forage/<timestamp>.md` (or `--out <path>`).

## When to use

A complex topic that needs rigorous, multi-source synthesis and a written report
(technical landscape, market/policy analysis, "is X production-ready"). Skip it
for quick lookups, product picks, or top-N lists — a plain search is faster.

## Flags

- `<topic>` — the research question (quote it)
- `--deep` — add reflection rounds + the verification pass (slower, deeper)
- `--facets N` — breadth: number of parallel searchers, 1–8 (default 4)
- `--model <id>` — override the searcher model
- `--out <path>` — write the report somewhere specific

## Notes

- Hard read-only: `--deny Write/Edit/Bash`, no `--always-approve`. It cannot
  touch your repo, only the web and X.
- Takes a few minutes; searchers run in true OS parallel.
