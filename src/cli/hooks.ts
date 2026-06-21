import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { resolveGrokHome } from "../utils/paths.js";
import { print, ok, warn, header, dim, bold } from "../utils/print.js";
import {
  buildHookEvent,
  dispatchHookEvent,
} from "../hooks/extensibility/dispatcher.js";
import { ggSessionId } from "../utils/paths.js";

type GrokHookEvent = "post-edit" | "pre-command" | "post-command" | "on-error";

export async function runHooksList(cwd: string): Promise<void> {
  const grokHome = resolveGrokHome();
  const hooksPath = join(grokHome, "hooks", "hooks.json");

  header("Registered Hooks");

  if (!existsSync(hooksPath)) {
    warn("hooks/hooks.json not found. Run `goblin setup` to install hooks.");
    return;
  }

  try {
    const parsed = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
      hooks?: Record<
        string,
        Array<{ matcher: string; hooks: Array<{ command: string }> }>
      >;
    };

    print(dim(`Location: ${hooksPath}`));
    print("");

    for (const [event, groups] of Object.entries(parsed.hooks ?? {})) {
      for (const group of groups) {
        for (const h of group.hooks) {
          const isGg =
            h.command.includes("goblin hook") ||
            h.command.includes("grokgoblin");
          print(
            `  ${bold(event.padEnd(14))} ${dim(group.matcher.padEnd(16))} ${isGg ? "[GrokGoblin]" : "     "} ${dim(h.command.slice(0, 50))}`
          );
        }
      }
    }
  } catch {
    warn("Could not parse hooks/hooks.json");
  }
}

export async function runHookDispatch(
  cwd: string,
  event: string,
  context: Record<string, unknown> = {}
): Promise<void> {
  const grokHome = resolveGrokHome();
  const sessionId =
    process.env["GG_SESSION_ID"] ?? ggSessionId(process.env);

  const envelope = buildHookEvent(event, sessionId, cwd, {
    ...context,
    grokHookEvent: process.env["GROK_HOOK_EVENT"],
    grokHookName: process.env["GROK_HOOK_NAME"],
    grokSessionId: process.env["GROK_SESSION_ID"],
  });

  const results = dispatchHookEvent(envelope, cwd, grokHome);

  const failures = results.filter((r) => !r.success);
  if (failures.length > 0) {
    warn(`${failures.length} hook plugin(s) failed during ${event} dispatch`);
  }
}
