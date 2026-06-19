# /research

Bounded evidence gathering with structured output.

## Purpose

Research gathers relevant evidence from the codebase and external sources
before making recommendations. It's pre-planning work — not implementation.

Use it when:
- You need to understand an unfamiliar codebase area before proposing changes
- You want to compare approaches with evidence before a `/goblinplan`
- You need to find all usage sites of a pattern before changing it

## Protocol

### Phase 1 — Scope Definition

State what you're researching and why. Set a time/turn budget.
Example: "Researching: all places that call the auth middleware. Budget: 5 turns."

### Phase 2 — Evidence Gathering

For codebase research:
- Read relevant files systematically (don't guess)
- Follow import chains to understand dependencies
- Find all usage sites before drawing conclusions
- Note version constraints and compatibility requirements

For external research (documentation, best practices):
- State your search query and why
- Quote relevant sections directly
- Note the source and date
- Flag if information might be outdated

### Phase 3 — Synthesis

Produce structured output:

```
## Research: {topic}

### Findings
1. {finding with evidence citation}
2. {finding with evidence citation}
...

### Key Files
- {path}: {why it's relevant}

### Patterns Observed
- {pattern}: used in {n} places

### Recommendations
Based on this research:
1. {recommendation}
2. {recommendation}

### Gaps
What I still don't know: {what couldn't be determined}

### Confidence
{High/Medium/Low} — {reasoning}
```

## Rules

- Read actual code before making claims about it
- Don't recommend approaches you haven't verified exist/work
- Keep the scope bounded — don't research everything, research what's needed
- Write findings as you go (don't hold all research until the end)

## Output

Research findings can be passed directly to `/goblinplan`:
"Take the above research and create a plan using `/goblinplan`."
