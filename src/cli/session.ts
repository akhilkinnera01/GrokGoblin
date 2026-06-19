import { join } from "path";
import { existsSync, readdirSync } from "fs";
import { resolveGgStateDir } from "../utils/paths.js";
import { readJsonFile } from "../utils/toml.js";
import { print, header, dim, bold } from "../utils/print.js";
import type { SessionState } from "../types/index.js";

export async function runSessionInfo(
  cwd: string,
  args: string[]
): Promise<void> {
  const stateDir = join(resolveGgStateDir(cwd), "state");

  header("GrokGoblin Sessions");

  if (!existsSync(stateDir)) {
    print(dim("No session state found in .grokgoblin/state/"));
    return;
  }

  const sessionDirs = readdirSync(stateDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("gg-"))
    .map((e) => e.name);

  if (sessionDirs.length === 0) {
    print(dim("No sessions recorded."));
    return;
  }

  for (const sessionId of sessionDirs.slice(-10)) {
    const sessionPath = join(stateDir, sessionId, "session.json");
    const session = readJsonFile<SessionState>(sessionPath);
    if (!session) continue;

    const startTime = new Date(session.startedAt).toLocaleString();
    print(
      `  ${bold(sessionId)} ${dim(startTime)} ${dim(session.cwd)}`
    );
  }

  print("");
  print(dim(`${sessionDirs.length} session(s) total`));
}
