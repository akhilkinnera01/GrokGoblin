import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";
import {
  resolveGrokHome,
  resolveSkillsDir,
  resolveGgStateDir,
  GROKGOBLIN_SKILLS,
} from "../utils/paths.js";
import { listAgentNames } from "../agents/definitions.js";
import { print, header, dim, bold, info } from "../utils/print.js";

function skillDirs(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter(
      (name) =>
        existsSync(join(skillsDir, name, "SKILL.md")) &&
        GROKGOBLIN_SKILLS.includes(name)
    )
    .sort();
}

function cruiseRuns(stateDir: string): Array<{ id: string; goal: string; mtime: number }> {
  const apDir = join(stateDir, "cruise");
  if (!existsSync(apDir)) return [];
  return readdirSync(apDir)
    .map((id) => {
      const dir = join(apDir, id);
      let goal = "(unknown goal)";
      const goalPath = join(dir, "goal.md");
      if (existsSync(goalPath)) {
        goal =
          readFileSync(goalPath, "utf-8")
            .split("\n")
            .find((l) => l.trim() && !l.startsWith("#"))
            ?.trim() ?? goal;
      }
      let mtime = 0;
      try {
        mtime = statSync(dir).mtimeMs;
      } catch {}
      return { id, goal, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

export async function runList(cwd: string, args: string[]): Promise<void> {
  const what = args[0];
  const grokHome = resolveGrokHome();
  const skillsDir = resolveSkillsDir(grokHome);
  const stateDir = resolveGgStateDir(cwd);

  const showAll = !what || what === "all";

  if (showAll || what === "skills") {
    const skills = skillDirs(skillsDir);
    header("Skills");
    print(dim(`${skillsDir}`));
    if (skills.length === 0) {
      info("No skills installed — run `gg setup`.");
    } else {
      print(skills.map((s) => `  /${s}`).join("\n"));
    }
    print("");
  }

  if (showAll || what === "agents" || what === "roles") {
    const agents = listAgentNames();
    header("Agent roles");
    print(agents.map((a) => `  ${a}`).join("\n"));
    print("");
  }

  if (showAll || what === "cruise" || what === "runs") {
    const runs = cruiseRuns(stateDir);
    header("Cruise runs");
    if (runs.length === 0) {
      info("No cruise runs in this repo.");
    } else {
      for (const r of runs.slice(0, 10)) {
        const when = r.mtime ? new Date(r.mtime).toLocaleString() : "?";
        print(`  ${bold(r.id)}  ${dim(when)}`);
        print(`    ${dim(r.goal.slice(0, 80))}`);
      }
    }
    print("");
  }

  if (showAll || what === "sessions") {
    const sessionState = join(stateDir, "state");
    header("Session state");
    if (existsSync(sessionState)) {
      const files = readdirSync(sessionState);
      print(files.length ? files.map((f) => `  ${f}`).join("\n") : dim("  (empty)"));
    } else {
      info("No session state in .grokgoblin/state/");
    }
    print("");
  }

  if (!showAll && !["skills", "agents", "roles", "cruise", "runs", "sessions"].includes(what!)) {
    info(`Unknown list target '${what}'. Try: skills | agents | cruise | sessions | all`);
  }
}
