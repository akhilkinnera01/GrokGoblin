#!/usr/bin/env node
import { main } from "./cli/index.js";

const args = process.argv.slice(2);

main(args).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\x1b[31merror:\x1b[0m ${msg}\n`);
  process.exit(1);
});
