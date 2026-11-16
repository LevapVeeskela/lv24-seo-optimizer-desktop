import { samePath, workspaceLabel } from "../lib/paths";

export const RECENT_WORKSPACES_KEY = "lv24.recentWorkspaces";
export const MAX_RECENT_WORKSPACES = 8;

export interface RecentWorkspace {
  /** Absolute `seo.toml` path, exactly as the shell reported it. */
  path: string;
  /** Site host or project name; falls back to the folder name. */
  label: string;
  /** Optional project base URL for the header chip. */
  site: string | null;
  /** ISO-8601 timestamp of the last successful activation. */
  openedAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Parse a persisted list defensively: a corrupted entry, an older schema or a
 * locked storage backend must never break the window.
 */
export function parseRecentWorkspaces(raw: string | null): RecentWorkspace[] {
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const seen: string[] = [];
  const entries: RecentWorkspace[] = [];
  for (const item of parsed) {
    const candidate = record(item);
    if (!candidate) {
      continue;
    }
    const path = text(candidate.path);
    if (!path || seen.some((known) => samePath(known, path))) {
      continue;
    }
    seen.push(path);
    const label = text(candidate.label) || workspaceLabel(path);
    const site = text(candidate.site);
    entries.push({
      path,
      label,
      site: site || null,
      openedAt: text(candidate.openedAt),
    });
    if (entries.length >= MAX_RECENT_WORKSPACES) {
      break;
    }
  }
  return entries;
}
