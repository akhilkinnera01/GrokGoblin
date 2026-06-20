import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveGrokHome, resolveGgStateDir, DEFAULT_FRONTIER_MODEL } from "../utils/paths.js";
import { commandExists, spawnGrokHeadless } from "../utils/exec.js";
import { print, header, ok, warn, dim } from "../utils/print.js";

export interface AutoresearchOptions {
  facets?: number;
  model?: string;
  out?: string;
}

// Read-only research workflow: a leader spawns parallel `researcher` subagents
// (capability-locked to read-only) across facets of a topic, then synthesizes a
// structured report. Nothing is modified — research only.
export async function runAutoresearch(
  cwd: string,
  topic: string,
  options: AutoresearchOptions = {}
): Promise<void> {
  const grokBin = process.env["GROK_BIN"] ?? "grok";
  if (!commandExists(grokBin)) {
    warn("grok CLI not found. Run `gg setup` first.");
    process.exit(1);
  }
  if (!topic.trim()) {
    warn('gg autoresearch requires a topic, e.g. `gg autoresearch "how is caching implemented"`');
    process.exit(1);
  }

  const facets = Math.min(6, Math.max(1, options.facets ?? 3));
  const model = options.model ?? DEFAULT_FRONTIER_MODEL;
  const grokHome = resolveGrokHome();

  header("GrokGoblin Autoresearch");
  print(`${dim("topic:")}  ${topic}`);
  print(`${dim("facets:")} up to ${facets} parallel researcher subagents`);
  print(`${dim("mode:")}   read-only (no files modified)`);
  print("");

  const prompt = [
    "You are the LEAD RESEARCHER. This is a READ-ONLY task: do NOT modify any files or run mutating commands. (Web search and X/Twitter search are read-only and ENCOURAGED — see Real-time grounding below.)",
    "",
    `## Research topic\n${topic}`,
    "",
    "## Method",
    `- Break the topic into up to ${facets} distinct facets/angles.`,
    "- Use the `task` tool to spawn parallel **researcher** subagents (one per facet). The researcher role is read-only.",
    "- Each subagent should gather evidence for its facet from BOTH the codebase (files, line numbers, snippets) AND, where relevant, current external sources.",
    "- Synthesize all findings into ONE structured report.",
    "",
    "## Real-time grounding (use grok's strengths)",
    "- Proactively use `web_search`/`web_fetch` for anything fast-moving or external: current library/API versions, best practices, comparisons, recent changes, security advisories. Prefer today's sources over training memory.",
    "- Use X/Twitter search for community signal, recent announcements, and real-world reports when the topic benefits.",
    "- Cite every external claim with its source URL. Note the date of time-sensitive facts.",
    "- For purely internal/codebase topics, grounding may be unnecessary — use judgement.",
    "",
    "## Report format",
    "1. **Summary** — the key answer in 3-5 sentences.",
    "2. **Findings by facet** — what each subagent found, with file/line references and/or cited external sources.",
    "3. **Sources** — external URLs used (with dates for time-sensitive facts).",
    "4. **Open questions / risks** — gaps or uncertainties.",
  ].join("\n");

  // No --tools restriction here: grok's native web_search/web_fetch/x_search stay
  // available for real-time grounding. --experimental-memory lets it recall prior research.
  const grokArgs = ["--always-approve", "--experimental-memory", "--output-format", "plain", "-m", model];
  const result = spawnGrokHeadless(
    prompt,
    grokArgs,
    { ...process.env, GROK_HOME: grokHome },
    grokBin
  );

  const output = (result.stdout || result.stderr || "").trim();
  if (output) print(output);
  print("");

  // Persist the report.
  const outPath = options.out
    ? (options.out.startsWith("/") ? options.out : join(cwd, options.out))
    : join(resolveGgStateDir(cwd), "research", `${Date.now()}.md`);
  try {
    const dir = join(outPath, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(outPath, `# Research: ${topic}\n\n${output}\n`, "utf-8");
    ok(`Report saved: ${outPath}`);
  } catch {
    warn("Could not save report file.");
  }

  if (!result.ok) warn(`grok exited with status ${result.status}.`);
}
