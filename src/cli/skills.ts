import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  resolveGrokHome,
  resolveSkillsDir,
  packageSkillsDir,
} from "../utils/paths.js";
import {
  print,
  ok,
  warn,
  info,
  header,
  dim,
  bold,
  printTable,
} from "../utils/print.js";

interface SkillMeta {
  name: string;
  path: string;
  description: string;
  invocation: string;
}

function readSkillMeta(skillDir: string, name: string): SkillMeta {
  const skillMdPath = join(skillDir, "SKILL.md");
  let description = "";
  if (existsSync(skillMdPath)) {
    const content = readFileSync(skillMdPath, "utf-8");
    const descMatch = content.match(/^(?:#[^\n]+\n+)?([^\n#][^\n]+)/m);
    description = descMatch?.[1]?.trim() ?? "";
    if (description.startsWith("*") || description.startsWith(">")) {
      description = description.slice(1).trim();
    }
  }
  return {
    name,
    path: skillDir,
    description: description.slice(0, 80),
    invocation: `/${name}`,
  };
}

export function getInstalledSkills(grokHome: string): SkillMeta[] {
  const skillsDir = resolveSkillsDir(grokHome);
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => readSkillMeta(join(skillsDir, e.name), e.name));
}

export async function runSkillsList(cwd: string): Promise<void> {
  const grokHome = resolveGrokHome();
  const skills = getInstalledSkills(grokHome);

  header("Installed GrokGoblin Skills");
  print(dim(`Location: ${resolveSkillsDir(grokHome)}`));
  print("");

  if (skills.length === 0) {
    warn("No skills installed. Run `gg setup` to install them.");
    return;
  }

  for (const skill of skills) {
    print(`  ${bold(skill.invocation.padEnd(22))} ${dim(skill.description)}`);
  }

  print("");
  print(dim(`${skills.length} skill(s) installed`));
  print(dim("Invoke in a Grok session with /<skill-name>"));
}

export async function runSkillsInfo(
  cwd: string,
  skillName: string
): Promise<void> {
  const grokHome = resolveGrokHome();
  const skillsDir = resolveSkillsDir(grokHome);
  const skillDir = join(skillsDir, skillName);

  if (!existsSync(skillDir)) {
    warn(`Skill '${skillName}' not found. Run \`gg skills list\` to see installed skills.`);
    process.exit(1);
  }

  const skillMdPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    warn(`No SKILL.md found for skill '${skillName}'`);
    process.exit(1);
  }

  const content = readFileSync(skillMdPath, "utf-8");
  print(content);
}

export async function runSkillsRefresh(cwd: string): Promise<void> {
  const { runSetup } = await import("./setup.js");
  await runSetup(cwd, { force: true, skip: ["config", "hooks"] });
}
