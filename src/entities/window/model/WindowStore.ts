import { makeAutoObservable } from "mobx";
import {
  DEFAULT_WINDOW,
  WINDOW_SETTINGS_KEY,
  WINDOW_SETTINGS_VERSION,
  browserStorage,
  isWindowLag,
  isWindowPreset,
  parseWindowSettingsMap,
  type StorageLike,
  type WindowLagDays,
  type WindowParams,
  type WindowPresetDays,
  type WindowSettings,
} from "./types";

function readStorage(storage: StorageLike | null): string | null {
  try {
    return storage?.getItem(WINDOW_SETTINGS_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Per-workspace reporting window. Settings are keyed by the active `seo.toml`
 * path, so switching back to a workspace restores its last choice; a workspace
 * with no saved entry starts from the audited default (7 days, lag 2).
 *
 * The store never invents a value the engine would reject: only the offered
 * presets are stored, and a corrupted entry falls back to the default.
 */
export class WindowStore {
  days: WindowPresetDays = DEFAULT_WINDOW.days;
  lagDays: WindowLagDays = DEFAULT_WINDOW.lagDays;
  workspacePath: string | null = null;

  private saved: Record<string, WindowSettings>;
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null = browserStorage()) {
    this.storage = storage;
    this.saved = parseWindowSettingsMap(readStorage(storage));
    makeAutoObservable<WindowStore, "saved" | "storage">(
      this,
      { saved: false, storage: false },
      { autoBind: true },
    );
  }

  get params(): WindowParams {
    return { days: this.days, lagDays: this.lagDays };
  }

  get isDefault(): boolean {
    return (
      this.days === DEFAULT_WINDOW.days && this.lagDays === DEFAULT_WINDOW.lagDays
    );
  }

  /** Load the saved window for `path`; a new workspace never inherits another. */
  useWorkspace(path: string | null): void {
    const next = path?.trim() || null;
    if (next === this.workspacePath) {
      return;
    }
    this.workspacePath = next;
    const stored = next ? this.saved[next] : undefined;
    this.days = stored?.days ?? DEFAULT_WINDOW.days;
    this.lagDays = stored?.lagDays ?? DEFAULT_WINDOW.lagDays;
  }

  setDays(days: number): void {
    if (!isWindowPreset(days) || days === this.days) {
      return;
    }
    this.days = days;
    this.persist();
  }

  setLagDays(lagDays: number): void {
    if (!isWindowLag(lagDays) || lagDays === this.lagDays) {
      return;
    }
    this.lagDays = lagDays;
    this.persist();
  }

  /** Restore the default and forget the saved choice for this workspace. */
  reset(): void {
    this.days = DEFAULT_WINDOW.days;
    this.lagDays = DEFAULT_WINDOW.lagDays;
    if (this.workspacePath) {
      delete this.saved[this.workspacePath];
    }
    this.persist();
  }

  private persist(): void {
    if (this.workspacePath) {
      this.saved = {
        ...this.saved,
        [this.workspacePath]: { days: this.days, lagDays: this.lagDays },
      };
    }
    try {
      this.storage?.setItem(
        WINDOW_SETTINGS_KEY,
        JSON.stringify({
          version: WINDOW_SETTINGS_VERSION,
          workspaces: this.saved,
        }),
      );
    } catch {
      // The choice still applies for this session when storage is unavailable.
    }
  }
}

/** One instance shared by every screen that reads or changes the window. */
export const windowStore = new WindowStore();
