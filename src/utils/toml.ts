import {
  readFileSync,
  writeFileSync,
  existsSync,
  appendFileSync,
  mkdirSync,
  renameSync,
} from "fs";
import TOML from "@iarna/toml";

export function readTomlFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    const content = readFileSync(filePath, "utf-8");
    return TOML.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function writeTomlFile(
  filePath: string,
  data: Record<string, unknown>
): void {
  const content = TOML.stringify(
    data as Parameters<typeof TOML.stringify>[0]
  );
  writeFileSync(filePath, content, "utf-8");
}

export function mergeTomlFile(
  filePath: string,
  updates: Record<string, unknown>
): void {
  const existing = readTomlFile(filePath);
  const merged = deepMerge(existing, updates);
  writeTomlFile(filePath, merged);
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof base[key] === "object" &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(
        base[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Read JSON written by an external/untrusted writer (e.g. the agent mutating
 * state files). If the file is missing, unparseable, or fails the supplied
 * shape check, it is quarantined (renamed to `<file>.corrupt`) so the next run
 * starts clean instead of repeatedly throwing/looping on bad data. Returns null
 * in every failure case.
 */
export function readJsonFileValidated<T>(
  filePath: string,
  validate: (value: unknown) => value is T
): T | null {
  if (!existsSync(filePath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    quarantineFile(filePath);
    return null;
  }
  if (!validate(parsed)) {
    quarantineFile(filePath);
    return null;
  }
  return parsed;
}

function quarantineFile(filePath: string): void {
  try {
    renameSync(filePath, `${filePath}.corrupt`);
  } catch {
    // best-effort: if we can't quarantine, leave it — the validated read still
    // returns null so callers degrade gracefully.
  }
}

/**
 * Atomically write JSON: serialize to a temp file in the same directory, then
 * rename over the target. A crash mid-write leaves the original intact instead
 * of a truncated, unparseable file.
 */
export function writeJsonFile(filePath: string, data: unknown): void {
  const payload = JSON.stringify(data, null, 2) + "\n";
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, payload, "utf-8");
    renameSync(tmp, filePath);
  } catch (err) {
    // Fall back to a direct write so callers still make progress on filesystems
    // where rename across the temp name isn't possible.
    writeFileSync(filePath, payload, "utf-8");
  }
}

export function appendJsonlLine(filePath: string, record: unknown): void {
  appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
}

export function readFileOrEmpty(filePath: string): string {
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf-8");
}

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}
