export function print(msg: string): void {
  process.stdout.write(msg + "\n");
}

export function printErr(msg: string): void {
  process.stderr.write(msg + "\n");
}

export function ok(msg: string): void {
  print(`\x1b[32m✓\x1b[0m ${msg}`);
}

export function warn(msg: string): void {
  print(`\x1b[33m⚠\x1b[0m ${msg}`);
}

export function fail(msg: string): void {
  print(`\x1b[31m✗\x1b[0m ${msg}`);
}

export function info(msg: string): void {
  print(`\x1b[36mℹ\x1b[0m ${msg}`);
}

export function step(msg: string): void {
  print(`\x1b[90m→\x1b[0m ${msg}`);
}

export function bold(msg: string): string {
  return `\x1b[1m${msg}\x1b[0m`;
}

export function dim(msg: string): string {
  return `\x1b[90m${msg}\x1b[0m`;
}

export function header(title: string): void {
  print("");
  print(bold(title));
  print(dim("─".repeat(title.length)));
}

export function printTable(
  rows: Array<[string, string]>,
  indent = "  "
): void {
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  for (const [key, value] of rows) {
    print(`${indent}${key.padEnd(maxKey + 2)}${dim(value)}`);
  }
}

export function exitWithError(msg: string, code = 1): never {
  printErr(`\x1b[31merror:\x1b[0m ${msg}`);
  process.exit(code);
}
