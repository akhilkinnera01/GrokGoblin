import {
  readFileSync,
  writeFileSync,
  existsSync,
  appendFileSync,
  mkdirSync,
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

export function writeJsonFile(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
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
