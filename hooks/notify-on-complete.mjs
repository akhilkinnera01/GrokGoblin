/**
 * Example GrokGoblin hook plugin: notify when a session ends
 *
 * Install to: ~/.grok/hooks/notify-on-complete.mjs
 * (gg setup copies this to ~/.grok/hooks/)
 *
 * Hook plugins receive the GrokGoblin event envelope via stdin
 * and should write a result object to stdout.
 */

import { readFileSync } from "fs";

const envelope = JSON.parse(readFileSync("/dev/stdin", "utf-8"));

if (envelope.event === "session-end") {
  const durationSec = envelope.context.durationMs
    ? Math.round(envelope.context.durationMs / 1000)
    : "?";

  // Could be extended to post to Slack, Discord, etc.
  // For now, just log
  process.stderr.write(
    `[GrokGoblin] Session ${envelope.sessionId} ended after ${durationSec}s\n`
  );
}

process.stdout.write(JSON.stringify({ success: true }) + "\n");
