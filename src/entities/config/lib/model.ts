import {
  cloneConfig,
  type ConfigModel,
} from "@/entities/config/model/types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Immutable field update for the known schema. Unknown paths fail loudly.
 *
 * Provider presence is never implied by a field edit: enabling and disabling a
 * provider block is an explicit `providers.<id>.present` write from the toggle,
 * otherwise a disabled block would silently come back on the next save.
 */
export function setConfigValue(
  model: ConfigModel,
  path: string,
  value: unknown,
): ConfigModel {
  const clone = cloneConfig(model);
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) {
    throw new Error("config path must not be empty");
  }
  let cursor = clone as unknown as Record<string, unknown>;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const next = cursor[parts[index]];
    if (!isRecord(next)) {
      throw new Error(`unknown config path: ${path}`);
    }
    cursor = next;
  }
  cursor[parts[parts.length - 1]] = value;
  return clone;
}

/** Structural equality used for dirty state and draft-vs-snapshot checks. */
export function configsEqual(
  left: ConfigModel | null,
  right: ConfigModel | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

export function getConfigValue(model: ConfigModel, path: string): unknown {
  let cursor: unknown = model;
  for (const part of path.split(".").filter(Boolean)) {
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

export function flattenConfig(model: ConfigModel): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  walk(model as unknown, "", out);
  return out;
}

function walk(value: unknown, prefix: string, out: Record<string, unknown>): void {
  if (Array.isArray(value)) {
    if (prefix) {
      out[prefix] = value;
    }
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      walk(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  if (prefix) {
    out[prefix] = value;
  }
}
