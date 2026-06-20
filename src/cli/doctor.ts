import { existsSync } from "fs";
import { join } from "path";
import type { DoctorCheckResult } from "../types/index.js";
import {
  resolveGrokHome,
  resolveSkillsDir,
  resolveAgentsMdPath,
  resolveGrokConfigPath,
} from "../utils/paths.js";
import {
  ok,
  warn,
  fail,
  header,
  print,
  dim,
  bold,
  printTable,
} from "../utils/print.js";
import { commandExists } from "../utils/exec.js";
import { readGrokConfig } from "../config/generator.js";

function check(
  name: string,
  condition: boolean,
  passMessage: string,
  failMessage?: string,
  fix?: string
): DoctorCheckResult {
  return {
    name,
    status: condition ? "ok" : "fail",
    message: condition ? passMessage : (failMessage ?? passMessage),
    fix,
  };
}

function warn_check(
  name: string,
  condition: boolean,
  passMsg: string,
  failMsg: string,
  fix?: string
): DoctorCheckResult {
  return {
    name,
    status: condition ? "ok" : "warn",
    message: condition ? passMsg : failMsg,
    fix: condition ? undefined : fix,
  };
}

export async function runDoctor(
  cwd: string,
  options: { verbose?: boolean; team?: boolean } = {}
): Promise<void> {
  const grokHome = resolveGrokHome();
  const results: DoctorCheckResult[] = [];

  header("gg doctor");
  print(dim(`grok home: ${grokHome}`));
  print(dim(`working dir: ${cwd}`));
  print("");

  results.push(
    check(
      "grok CLI",
      commandExists("grok"),
      "grok CLI found on PATH",
      "Install grok CLI: curl -fsSL https://x.ai/cli/install.sh | sh"
    )
  );

  // grok authenticates via `grok login` (session token in <grokHome>/auth.json)
  // OR via XAI_API_KEY. Either is sufficient, so this is a warning, not a failure.
  const hasApiKey = Boolean(
    process.env["XAI_API_KEY"] ?? process.env["GROK_CODE_XAI_API_KEY"]
  );
  const hasSessionAuth = existsSync(join(grokHome, "auth.json"));
  results.push(
    warn_check(
      "grok auth",
      hasApiKey || hasSessionAuth,
      hasApiKey ? "XAI_API_KEY is set" : "Signed in via `grok login`",
      "Not authenticated — run `grok login` or set XAI_API_KEY=xai-..."
    )
  );

  results.push(
    check(
      "~/.grok directory",
      existsSync(grokHome),
      `${grokHome} exists`,
      `Run \`gg setup\` to create it`,
      "gg setup"
    )
  );

  const agentsMdPath = resolveAgentsMdPath(grokHome);
  const hasAgentsMd = existsSync(agentsMdPath);
  results.push(
    check(
      "AGENTS.md",
      hasAgentsMd,
      `AGENTS.md present at ${agentsMdPath}`,
      `Missing AGENTS.md — run \`gg setup\``,
      "gg setup"
    )
  );

  if (hasAgentsMd) {
    const { readFileOrEmpty } = await import("../utils/toml.js");
    const content = readFileOrEmpty(agentsMdPath);
    results.push(
      warn_check(
        "AGENTS.md GrokGoblin content",
        content.includes("grokgoblin") || content.includes("GrokGoblin"),
        "AGENTS.md has GrokGoblin orchestration brain",
        "AGENTS.md exists but missing GrokGoblin content — run `gg setup --force`",
        "gg setup --force"
      )
    );
  }

  const skillsDir = resolveSkillsDir(grokHome);
  results.push(
    warn_check(
      "skills directory",
      existsSync(skillsDir),
      `Skills directory present at ${skillsDir}`,
      "Skills directory missing — run `gg setup`",
      "gg setup"
    )
  );

  if (existsSync(skillsDir)) {
    const { readdirSync } = await import("fs");
    const installed = readdirSync(skillsDir).filter(
      (d) => !d.startsWith(".")
    );
    results.push(
      warn_check(
        "installed skills",
        installed.length > 0,
        `${installed.length} skill(s) installed: ${installed.join(", ")}`,
        "No skills installed — run `gg setup`",
        "gg setup"
      )
    );
  }

  // grok loads global hooks from <grokHome>/hooks/hooks.json (Claude Code schema).
  const hooksJsonPath = join(grokHome, "hooks", "hooks.json");
  results.push(
    warn_check(
      "hooks.json",
      existsSync(hooksJsonPath),
      "hooks/hooks.json present",
      "hooks/hooks.json missing — run `gg setup`",
      "gg setup"
    )
  );

  const { countInstalledRoles } = await import("../config/subagents.js");
  const roleCount = countInstalledRoles(grokHome);
  results.push(
    warn_check(
      "subagent roles",
      roleCount > 0,
      `${roleCount} grok subagent roles registered`,
      "no subagent roles in config.toml — run `gg setup`",
      "gg setup"
    )
  );

  if (existsSync(hooksJsonPath)) {
    const { readFileOrEmpty } = await import("../utils/toml.js");
    const content = readFileOrEmpty(hooksJsonPath);
    // Real check: hooks must be in grok's schema (a "hooks" object with command
    // entries calling `gg hook`), not just any file mentioning gg.
    let registered = false;
    try {
      const parsed = JSON.parse(content);
      registered =
        Boolean(parsed?.hooks) &&
        /(grokgoblin|gg)['"]?\s+hook\b/.test(content);
    } catch {
      registered = false;
    }
    results.push(
      warn_check(
        "GrokGoblin hooks registered",
        registered,
        "GrokGoblin hooks registered in grok hook schema",
        "hooks file exists but GrokGoblin hooks not in grok schema — run `gg setup`",
        "gg setup"
      )
    );
  }

  const configPath = resolveGrokConfigPath(grokHome);
  results.push(
    warn_check(
      "config.toml",
      existsSync(configPath),
      "config.toml present",
      "config.toml missing — run `gg setup` to create defaults",
      "gg setup"
    )
  );

  if (existsSync(configPath)) {
    const config = readGrokConfig(grokHome);
    const defaultModel = config.models?.default;
    results.push(
      warn_check(
        "default model",
        typeof defaultModel === "string" && defaultModel.length > 0,
        `[models].default = ${defaultModel}`,
        "[models].default not set — run `gg setup`",
        "gg setup"
      )
    );
    // Flag leftover dead keys from older GrokGoblin versions.
    const hasLegacy =
      "developer_instructions" in config ||
      "model_context_window" in config ||
      "auto_compact_threshold" in config;
    if (hasLegacy) {
      results.push(
        warn_check(
          "legacy config keys",
          false,
          "",
          "config.toml has dead GrokGoblin keys — run `gg setup` to clean them"
        )
      );
    }
  }

  results.push(
    warn_check(
      ".grokgoblin/ state directory",
      existsSync(join(cwd, ".grokgoblin")),
      ".grokgoblin/ state directory present",
      ".grokgoblin/ state directory missing — run `gg setup`",
      "gg setup"
    )
  );

  if (options.team) {
    results.push(
      warn_check(
        "tmux (for team mode)",
        commandExists("tmux"),
        "tmux found — team mode available",
        "tmux not found — install it for team mode",
        "brew install tmux"
      )
    );
  }

  print("");

  let hasFailures = false;
  let hasWarnings = false;

  for (const result of results) {
    if (result.status === "ok") {
      ok(result.message);
    } else if (result.status === "warn") {
      warn(result.message);
      hasWarnings = true;
    } else {
      fail(result.message);
      hasFailures = true;
    }
    if (result.fix && options.verbose) {
      print(dim(`  fix: ${result.fix}`));
    }
  }

  print("");

  const failCount = results.filter((r) => r.status === "fail").length;
  const warnCount = results.filter((r) => r.status === "warn").length;
  const okCount = results.filter((r) => r.status === "ok").length;

  printTable([
    ["passed", `${okCount}`],
    ["warnings", `${warnCount}`],
    ["failures", `${failCount}`],
  ]);

  print("");

  if (hasFailures) {
    fail("Doctor found critical issues. Run `gg setup` to fix.");
    process.exit(1);
  } else if (hasWarnings) {
    warn("Doctor found warnings. Run `gg setup` to resolve.");
  } else {
    ok("All checks passed. grokgoblin is healthy.");
    print("");
    print(dim("Run `gg exec --check` to verify grok can authenticate."));
  }
}
