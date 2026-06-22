import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  resolveGrokHome,
  resolveGgStateDir,
  DEFAULT_MODEL,
  DEFAULT_FAST_MODEL,
} from "../utils/paths.js";
import {
  commandExists,
  spawnGrokHeadless,
  spawnGrokHeadlessAsync,
} from "../utils/exec.js";
import { print, header, ok, warn, dim, bold } from "../utils/print.js";

export interface ForageOptions {
  facets?: number;
  depth?: "quick" | "deep";
  model?: string;
  out?: string;
}

// Hard read-only capability lock for every research subprocess. grok's --deny
// matches Claude-Code-style permission CATEGORIES (not raw tool names): denying
// Write + Edit + Bash blocks the write tool, the edit tool, AND every shell
// write path (echo/perl/python), so a searcher physically cannot modify anything,
// while web + X + read tools stay available. Verified: with these denies a
// searcher told to write a file could not, via any method.
// IMPORTANT: never pair this with `--always-approve` — that auto-approves around
// deny rules (verified: a denied write still went through with both set).
// Without --always-approve, grok still auto-runs safe read/web/X tools headless.
const READONLY_LOCK = [
  "--deny", "Write",
  "--deny", "Edit",
  "--deny", "Bash",
];

const PLAN_TIMEOUT_MS = 3 * 60 * 1000;
const RESEARCH_TIMEOUT_MS = 8 * 60 * 1000;
const SYNTH_TIMEOUT_MS = 8 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 8 * 60 * 1000;
// Higher turn budget = each searcher does several searches AND opens full pages
// (not just snippets) before reporting.
const RESEARCH_MAX_TURNS = 18;
// Deep mode runs the initial round + up to (MAX_DEEP_ROUNDS-1) reflect→search
// rounds, stopping early when the reflector reports no material gaps.
const MAX_DEEP_ROUNDS = 3;

// Deep research = plan → parallel search → (deep: reflect → search) → synthesize.
// Each searcher is a SEPARATE headless `grok -p` process (true OS-level
// parallelism via spawnGrokHeadlessAsync) rather than in-process subagents,
// which are unreliable headless. grok's live web + X search are the gathering
// tools; X is used first-class for real-time/community signal grounding.
export async function runForage(
  cwd: string,
  topic: string,
  options: ForageOptions = {}
): Promise<void> {
  header("Forage — deep research");

  if (!topic) {
    warn('Give a topic, e.g. goblin forage "state of Rust web frameworks in 2026"');
    print(dim("  --facets N    breadth (parallel searchers, 1–8)"));
    print(dim("  --deep        add a reflection round that chases gaps"));
    return;
  }

  const grokBin = process.env["GROK_BIN"] ?? "grok";
  if (!commandExists(grokBin)) {
    warn("grok CLI not found. Run `goblin setup` first.");
    return;
  }

  const grokHome = resolveGrokHome();
  // No shared MCP leader socket: research only needs grok's BUILT-IN web/X/read
  // tools, so each searcher runs as a clean, isolated process — nothing to gain
  // from warming/sharing the user's MCP leader for a read-only run.
  const leaderArgs: string[] = [];
  const env = { ...process.env, GROK_HOME: grokHome };
  const facets = clamp(options.facets, 4, 1, 8);
  const deep = options.depth === "deep";
  // Searchers run on the fast model: it lacks native backend search
  // (supports_backend_search:false) but still invokes the web_search / x_* tools
  // fine — tool-invoked — so fast parallel searchers work. The reasoning steps
  // (plan/reflect/verify/synth) use grok-build for its 512K context.
  const researchModel = options.model ?? DEFAULT_FAST_MODEL;
  const synthModel = options.model ?? DEFAULT_MODEL;

  print(`${dim("topic:")}  ${topic}`);
  print(`${dim("plan:")}   up to ${facets} parallel searchers${deep ? " · +reflection round" : ""}`);
  print(dim("Live web + X search. This takes a few minutes — searchers run in parallel.\n"));

  // ── Phase 1: plan — decompose into independent sub-questions ──────────────
  print(bold("① Planning research angles…"));
  let questions = planQuestions(topic, facets, env, grokBin, leaderArgs);
  if (questions.length === 0) questions = [topic];
  for (const q of questions) print(dim(`   • ${q}`));

  // ── Phase 2: iterative gather — search, reflect on gaps, search again ──────
  // quick = 1 round; deep = up to MAX_DEEP_ROUNDS, stopping early when the
  // reflector finds no material gaps (this is the "iterate harder" knob).
  const maxRounds = deep ? MAX_DEEP_ROUNDS : 1;
  let briefs: Brief[] = [];
  let pending = questions;
  for (let round = 1; pending.length > 0 && round <= maxRounds; round++) {
    print(bold(`\n② Searching — round ${round}/${maxRounds} (${pending.length} parallel)…`));
    const found = await gather(topic, pending, researchModel, env, grokBin, leaderArgs);
    reportBriefs(found);
    briefs = briefs.concat(found);
    if (round >= maxRounds) break;
    print(dim("   reflecting on gaps…"));
    pending = reflect(topic, briefs, Math.ceil(facets / 2), env, grokBin, leaderArgs);
    if (pending.length === 0) { print(dim("   coverage looks complete.")); break; }
    for (const q of pending) print(dim(`   ↳ ${q}`));
  }

  const usable = briefs.filter((b) => b.ok && b.text.length > 40);
  if (usable.length === 0) {
    warn("No usable research came back (searchers failed or timed out). Try again or narrow the topic.");
    return;
  }

  // ── Phase 3: verification — re-check key claims against sources (deep) ─────
  let verification = "";
  if (deep) {
    print(bold("\n③ Verifying claims against sources…"));
    verification = verifyClaims(topic, usable, synthModel, env, grokBin, leaderArgs);
    if (verification) print(dim("   verification notes attached to synthesis."));
  }

  // ── Phase 4: synthesize a single cited report ─────────────────────────────
  print(bold(`\n${deep ? "④" : "③"} Synthesizing report…`));
  const report = synthesize(topic, usable, verification, synthModel, deep ? "deep" : "quick", env, grokBin, leaderArgs);
  if (!report) {
    warn("Synthesis failed. The raw findings are still saved below.");
  }

  const body = report || usable.map((b) => `## ${b.question}\n\n${b.text}`).join("\n\n");
  const outPath = options.out
    ? (options.out.startsWith("/") ? options.out : join(cwd, options.out))
    : join(resolveGgStateDir(cwd), "forage", `${Date.now()}.md`);
  try {
    const dir = join(outPath, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(outPath, `# Research: ${topic}\n\n${body}\n`, "utf-8");
    print("");
    ok(`Report saved: ${outPath}`);
    print(dim(`${usable.length} searches synthesized${deep ? " over 2 rounds" : ""}.`));
  } catch {
    warn("Could not save the report file.");
    print("\n" + body);
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

interface Brief {
  question: string;
  text: string;
  ok: boolean;
}

function clamp(v: number | undefined, dflt: number, lo: number, hi: number): number {
  const n = Number.isFinite(v) ? Math.floor(v as number) : dflt;
  return Math.min(hi, Math.max(lo, n));
}

// Planner: split the topic into independent, parallelizable sub-questions.
function planQuestions(
  topic: string,
  max: number,
  env: NodeJS.ProcessEnv,
  grokBin: string,
  leaderArgs: string[]
): string[] {
  const prompt = [
    "You are the lead researcher planning a DEEP RESEARCH report.",
    `Decompose the topic into AT MOST ${max} INDEPENDENT sub-questions that can be researched in PARALLEL.`,
    "Cover distinct angles: current state/landscape, evidence & data, tradeoffs & criticism,",
    "and at least one angle for REAL-TIME / community signal (best answered via X search).",
    "",
    `## Topic\n${topic}`,
    "",
    "## Output",
    'Output ONLY a JSON array of strings (the sub-questions), no prose. Example: ["…","…"]',
  ].join("\n");

  const res = spawnGrokHeadless(
    prompt,
    // ponytail: default model (grok-build) — decomposition quality sets the ceiling for the whole run
    ["-m", DEFAULT_MODEL, ...READONLY_LOCK, "--output-format", "plain", ...leaderArgs],
    env,
    grokBin,
    PLAN_TIMEOUT_MS
  );
  return parseStringArray(res.stdout).slice(0, max);
}

function researcherPrompt(topic: string, question: string): string {
  return [
    "You are a research goblin. Investigate ONE sub-question of a larger topic and report findings.",
    "READ-ONLY: use search and read tools only — do NOT create, edit, or delete any files.",
    "",
    `## Overall topic (context)\n${topic}`,
    `## Your sub-question\n${question}`,
    "",
    "## How to research (be thorough — do NOT stop at search snippets)",
    "- Use `web_search` to find authoritative/primary sources (docs, papers, benchmarks, vendor pages).",
    "- Then `open_page` (or `web_fetch`) and actually READ at least 3–5 distinct high-quality results —",
    "  extract specific numbers, versions, dates, and quotes from the full text, not the snippet.",
    "  (More is better: a thorough answer cites 5+ sources you opened, not 1–2 snippets.)",
    "- Use X / real-time search for the community pulse: what practitioners say right now, recency,",
    "  sentiment, and emerging issues. Prefer signal from credible accounts; capture handle + date.",
    "- Cross-check every key claim across at least two INDEPENDENT sources. Note disagreement explicitly.",
    "- Keep searching until you can support each finding with a source you actually opened.",
    "",
    "## Output (markdown, concise)",
    "- 4–8 bullet findings, each with an inline source you OPENED: a URL, or an X handle + date.",
    "- Quote the exact figure/version/date where relevant (don't paraphrase numbers).",
    "- A one-line **Confidence:** high/medium/low with why.",
    "- A short **Gaps:** line if something stayed unresolved.",
  ].join("\n");
}

async function gather(
  topic: string,
  questions: string[],
  model: string,
  env: NodeJS.ProcessEnv,
  grokBin: string,
  leaderArgs: string[]
): Promise<Brief[]> {
  const args = [
    "-m", model,
    ...READONLY_LOCK,
    "--max-turns", String(RESEARCH_MAX_TURNS),
    "--output-format", "plain",
    ...leaderArgs,
  ];
  const jobs = questions.map(async (question) => {
    const res = await spawnGrokHeadlessAsync(researcherPrompt(topic, question), args, {
      env,
      grokBin,
      timeoutMs: RESEARCH_TIMEOUT_MS,
    });
    return { question, text: (res.stdout || "").trim(), ok: res.ok };
  });
  return Promise.all(jobs);
}

// Lead reads every brief and names the gaps worth a second round.
function reflect(
  topic: string,
  briefs: Brief[],
  max: number,
  env: NodeJS.ProcessEnv,
  grokBin: string,
  leaderArgs: string[]
): string[] {
  const corpus = briefs
    .filter((b) => b.ok)
    .map((b) => `### ${b.question}\n${b.text}`)
    .join("\n\n");
  if (!corpus) return [];
  const prompt = [
    "You are the lead researcher reviewing the findings so far for a deep-research report.",
    `## Topic\n${topic}`,
    "",
    "## Findings so far",
    corpus,
    "",
    "## Task",
    `Identify the most important GAPS, contradictions, or unverified claims. Emit AT MOST ${max}`,
    "follow-up sub-questions that would close them. If coverage is already solid, output [].",
    "",
    "## Output",
    'Output ONLY a JSON array of strings, no prose.',
  ].join("\n");
  const res = spawnGrokHeadless(
    prompt,
    // ponytail: default model (grok-build) — gap-finding decides what the second round even looks at
    ["-m", DEFAULT_MODEL, ...READONLY_LOCK, "--output-format", "plain", ...leaderArgs],
    env,
    grokBin,
    PLAN_TIMEOUT_MS
  );
  return parseStringArray(res.stdout).slice(0, max);
}

// Independent fact-checker: re-verify the key claims in the findings against
// their sources (it can web_search / open_page to confirm), and flag anything
// unsupported or wrong. Read-only; output feeds the synthesizer.
function verifyClaims(
  topic: string,
  briefs: Brief[],
  model: string,
  env: NodeJS.ProcessEnv,
  grokBin: string,
  leaderArgs: string[]
): string {
  const corpus = briefs.map((b) => `### ${b.question}\n${b.text}`).join("\n\n");
  const prompt = [
    "You are an independent fact-checker reviewing research findings before they become a report.",
    `## Topic\n${topic}`,
    "",
    "## Findings to verify",
    corpus,
    "",
    "## Task",
    "Pull out the load-bearing factual/numeric claims (versions, dates, benchmarks, who-said-what).",
    "Re-verify each by searching and OPENING the cited (or a better primary) source — do not trust",
    "the brief alone. Then output a markdown section titled `## Verification`:",
    "- ✅ **Confirmed:** claim — source you opened.",
    "- ⚠️ **Corrected:** the wrong claim → the correct fact, with the source.",
    "- ❌ **Unsupported:** claim you could not substantiate (should be dropped).",
    "Be specific and terse. Only output the Verification section.",
  ].join("\n");
  const res = spawnGrokHeadless(
    prompt,
    ["-m", model, ...READONLY_LOCK, "--output-format", "plain", ...leaderArgs],
    env,
    grokBin,
    VERIFY_TIMEOUT_MS
  );
  return stripCodeFence((res.stdout || "").trim());
}

function synthesize(
  topic: string,
  briefs: Brief[],
  verification: string,
  model: string,
  depth: "quick" | "deep",
  env: NodeJS.ProcessEnv,
  grokBin: string,
  leaderArgs: string[]
): string {
  const corpus = briefs.map((b) => `### ${b.question}\n${b.text}`).join("\n\n");
  const prompt = [
    "You are the lead researcher writing the FINAL deep-research report from your team's findings.",
    `## Topic\n${topic}`,
    "",
    "## Raw findings from parallel searchers",
    corpus,
    verification ? `\n## Fact-checker's verification (AUTHORITATIVE — obey it)\n${verification}` : "",
    "",
    "## Write the report (markdown)",
    "1. **Summary** — 3–5 sentences answering the topic directly.",
    "2. **Key findings** — grouped by theme, each claim carrying its source (URL or X handle + date).",
    "3. **Contrarian views & risks** — counterarguments, limitations, failure modes, dissenting sources.",
    "4. **Tensions & open questions** — disagreements between sources, and what's still unresolved.",
    "5. **Sources** — deduplicated list of the strongest references used.",
    `6. **Rerun inputs** — a fenced block exactly:\n\`\`\`\nworkflow: forage\ntopic: ${topic}\ndepth: ${depth}\n\`\`\``,
    verification
      ? "Apply the fact-checker's verdicts: use ⚠️ corrections, and DROP any ❌ unsupported claim entirely."
      : "",
    "Be specific and cite. Do not invent sources. Flag low-confidence claims as such.",
    "Output ONLY the report markdown.",
  ].filter(Boolean).join("\n");
  const res = spawnGrokHeadless(
    prompt,
    ["-m", model, ...READONLY_LOCK, "--output-format", "plain", ...leaderArgs],
    env,
    grokBin,
    SYNTH_TIMEOUT_MS
  );
  return stripCodeFence((res.stdout || "").trim());
}

// Models sometimes wrap the whole report in a ```markdown … ``` fence. Unwrap it.
function stripCodeFence(text: string): string {
  const m = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return m ? m[1].trim() : text;
}

function reportBriefs(briefs: Brief[]): void {
  for (const b of briefs) {
    const status = b.ok && b.text.length > 40 ? dim("✓") : warn_("✕");
    print(`   ${status} ${b.question.slice(0, 70)}`);
  }
}
function warn_(s: string): string {
  return `\x1b[33m${s}\x1b[0m`;
}

// Extract the first JSON string-array from model output (tolerates surrounding prose).
function parseStringArray(raw: string | undefined): string[] {
  const text = (raw || "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s) => String(s).trim()).filter((s) => s.length > 0);
  } catch {
    return [];
  }
}
