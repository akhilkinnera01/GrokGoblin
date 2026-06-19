import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "fs";
import { join } from "path";
import { resolveGrokHome, DEFAULT_FAST_MODEL } from "../utils/paths.js";
import { isGitRepo, gitRepoRoot, spawnGrokHeadless } from "../utils/exec.js";
import { commandExists } from "../utils/exec.js";
import {
  print,
  header,
  ok,
  warn,
  info,
  step,
  dim,
  bold,
  exitWithError,
} from "../utils/print.js";

const COMPLETE_SENTINEL = "CRUISE-COMPLETE";
const CONTINUE_SENTINEL = "CRUISE-CONTINUE";
const DEFAULT_MAX_ITERATIONS = 8;

export interface CruiseOptions {
  maxIterations?: number;
  model?: string;
  fast?: boolean;
  skipGitRepoCheck?: boolean;
}

function buildIterationPrompt(
  goal: string,
  iteration: number,
  maxIterations: number,
  progressSoFar: string
): string {
  return [
    "You are running autonomously inside `gg cruise` — a headless loop that re-invokes you each iteration.",
    `Iteration ${iteration} of at most ${maxIterations}.`,
    "",
    "## Goal",
    goal,
    "",
    "## Progress so far (from previous iterations)",
    progressSoFar.trim() || "(none yet — this is the first iteration)",
    "",
    "## Instructions",
    "- Make concrete, incremental progress toward the goal THIS iteration (edit files, run commands, fix failures).",
    "- Do not re-do work already completed above. Build on it.",
    "- Verify your work (build/tests) when relevant.",
    "- Keep your response focused: a short summary of what you did and what remains.",
    "",
    "## Required final line",
    `End your response with EXACTLY one of these on its own line:`,
    `- \`${COMPLETE_SENTINEL}\` — the goal is fully achieved and verified.`,
    `- \`${CONTINUE_SENTINEL}\` — more work remains for the next iteration.`,
  ].join("\n");
}

export async function runCruise(
  cwd: string,
  goal: string,
  options: CruiseOptions = {}
): Promise<void> {
  const grokBin = process.env["GROK_BIN"] ?? "grok";
  const grokHome = resolveGrokHome();

  if (!commandExists(grokBin)) {
    exitWithError("grok not found on PATH. Install grok first.");
  }
  if (!goal.trim()) {
    exitWithError('gg cruise requires a goal, e.g. `gg cruise "add tests for parser"`');
  }
  if (!options.skipGitRepoCheck && !isGitRepo(cwd)) {
    exitWithError("Not in a git repository. cruise edits code — run inside a repo or pass --skip-git-repo-check.");
  }

  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const model = options.model ?? (options.fast ? DEFAULT_FAST_MODEL : undefined);

  const repoRoot = gitRepoRoot(cwd) ?? cwd;
  const runId = `${Date.now()}`;
  const runDir = join(repoRoot, ".grokgoblin", "cruise", runId);
  mkdirSync(runDir, { recursive: true });
  const logPath = join(runDir, "log.jsonl");
  const progressPath = join(runDir, "progress.md");
  writeFileSync(join(runDir, "goal.md"), `# Cruise goal\n\n${goal}\n`, "utf-8");
  writeFileSync(progressPath, "", "utf-8");

  header("GrokGoblin Cruise");
  print(`${dim("goal:")}  ${goal}`);
  print(`${dim("model:")} ${model ?? "(grok default)"}`);
  print(`${dim("max:")}   ${maxIterations} iterations`);
  print(`${dim("state:")} ${runDir}`);
  print("");

  const grokArgs = ["--always-approve", "--experimental-memory", "--output-format", "plain"];
  if (model) grokArgs.push("-m", model);

  let completed = false;
  for (let i = 1; i <= maxIterations; i++) {
    step(`Iteration ${i}/${maxIterations}...`);
    const progressSoFar = existsSync(progressPath)
      ? readFileSync(progressPath, "utf-8")
      : "";
    const prompt = buildIterationPrompt(goal, i, maxIterations, tail(progressSoFar, 6000));

    const result = spawnGrokHeadless(
      prompt,
      grokArgs,
      { ...process.env, GROK_HOME: grokHome },
      grokBin
    );

    const output = (result.stdout || result.stderr || "").trim();
    appendFileSync(
      logPath,
      JSON.stringify({
        iteration: i,
        ts: new Date().toISOString(),
        status: result.status,
        output,
      }) + "\n",
      "utf-8"
    );

    if (!result.ok && !output) {
      warn(`Iteration ${i} failed (grok exit ${result.status}). Stopping.`);
      if (result.stderr) print(dim(tail(result.stderr, 500)));
      break;
    }

    const summary = stripSentinels(output);
    appendFileSync(
      progressPath,
      `\n## Iteration ${i}\n${summary.trim()}\n`,
      "utf-8"
    );

    // Show a compact view of what happened this iteration.
    print(dim(indent(tail(summary, 800))));

    if (output.includes(COMPLETE_SENTINEL)) {
      completed = true;
      ok(`Goal reported complete after ${i} iteration(s).`);
      break;
    }
    info(`Iteration ${i} done — continuing.`);
  }

  print("");
  if (completed) {
    ok("Cruise finished: goal complete.");
  } else {
    warn(`Cruise stopped after ${maxIterations} iteration(s) without a ${COMPLETE_SENTINEL} signal.`);
    print(dim(`Review progress: ${progressPath}`));
  }
  print(dim(`Full log: ${logPath}`));
}

function tail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return "...(truncated)...\n" + text.slice(text.length - maxChars);
}

function stripSentinels(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return t !== COMPLETE_SENTINEL && t !== CONTINUE_SENTINEL;
    })
    .join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}
