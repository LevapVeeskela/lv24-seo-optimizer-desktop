/**
 * Reporting window shared by stats and the weekly report.
 *
 * The engine accepts any `days` in 1..365 and any `lagDays` in 0..30, but the
 * desktop only offers the audited presets: a free-form number would let the UI
 * request windows the report copy does not explain.
 */
export const WINDOW_PRESETS = [7, 28, 90] as const;
export type WindowPresetDays = (typeof WINDOW_PRESETS)[number];

export const WINDOW_LAG_OPTIONS = [2, 3] as const;
export type WindowLagDays = (typeof WINDOW_LAG_OPTIONS)[number];

export const WINDOW_SETTINGS_KEY = "lv24.windowSettings";
export const WINDOW_SETTINGS_VERSION = 1;

export interface WindowSettings {
  days: WindowPresetDays;
  lagDays: WindowLagDays;
}

/** Arguments passed to `stats` / `report_weekly` through `cliRun`. */
export interface WindowParams {
  days: number;
  lagDays: number;
}

export const DEFAULT_WINDOW: WindowSettings = { days: 7, lagDays: 2 };

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

export function isWindowPreset(value: unknown): value is WindowPresetDays {
  return WINDOW_PRESETS.some((preset) => preset === value);
}

export function isWindowLag(value: unknown): value is WindowLagDays {
  return WINDOW_LAG_OPTIONS.some((option) => option === value);
}

export function sameWindowParams(
  left: WindowParams | null,
  right: WindowParams,
): boolean {
  return (
    left !== null && left.days === right.days && left.lagDays === right.lagDays
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Parse one stored entry; anything unknown falls back to `null`. */
export function parseWindowSettings(value: unknown): WindowSettings | null {
  const entry = record(value);
  if (!entry) {
    return null;
  }
  if (!isWindowPreset(entry.days) || !isWindowLag(entry.lagDays)) {
    return null;
  }
  return { days: entry.days, lagDays: entry.lagDays };
}

/**
 * Parse the persisted per-workspace map. A corrupted entry, an older schema or
 * a locked storage backend must never break the window.
 */
export function parseWindowSettingsMap(
  raw: string | null,
): Record<string, WindowSettings> {
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
  const wrapper = record(parsed);
  const entries = record(wrapper?.workspaces ?? parsed);
  if (!entries) {
    return {};
  }
  const map: Record<string, WindowSettings> = {};
  for (const [path, value] of Object.entries(entries)) {
    const key = path.trim();
    const settings = parseWindowSettings(value);
    if (key && settings) {
      map[key] = settings;
    }
  }
  return map;
}
