import { toAppError, type AppError } from "@/shared/lib/errors";
import { makeAutoObservable } from "mobx";
import { samePath, workspaceLabel } from "../lib/paths";
import {
  MAX_RECENT_WORKSPACES,
  RECENT_WORKSPACES_KEY,
  browserStorage,
  parseRecentWorkspaces,
  type RecentWorkspace,
  type StorageLike,
} from "./types";

/** Shell/store operations the workspace list needs, injected for tests. */
export interface WorkspaceDeps {
  /** Persist the selected `seo.toml` through `settings_set`. */
  setConfigPath(path: string): Promise<void>;
  /** Re-read `shell_status` after the switch. */
  reloadShell(): Promise<void>;
  /** Currently active config path, or null. */
  activePath(): string | null;
  /** Refresh provider statistics for the new workspace. */
  refreshStats(): Promise<void>;
  /** True when the shell reports a config path whose file is gone. */
  configMissing(): boolean;
}

export interface WorkspaceActivation {
  ok: boolean;
  error: AppError | null;
}

function readStorage(storage: StorageLike | null): string | null {
  try {
    return storage?.getItem(RECENT_WORKSPACES_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(storage: StorageLike | null, list: RecentWorkspace[]): void {
  try {
    storage?.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(list));
  } catch {
    // The list still works for this session when storage is unavailable.
  }
}

function failure(code: string, message: string): AppError {
  return { code, message, retryable: false };
}

/**
 * Recent workspaces are a UI convenience, not a security boundary: the shell
 * still decides which config path may become active (SEC-05). This store only
 * remembers what the user already opened and asks the shell to switch back.
 */
export class WorkspaceStore {
  recents: RecentWorkspace[] = [];
  activatingPath: string | null = null;
  error: AppError | null = null;
  private readonly deps: WorkspaceDeps;
  private readonly storage: StorageLike | null;

  constructor(deps: WorkspaceDeps, storage: StorageLike | null = browserStorage()) {
    this.deps = deps;
    this.storage = storage;
    this.recents = parseRecentWorkspaces(readStorage(storage));
    makeAutoObservable<WorkspaceStore, "deps" | "storage">(
      this,
      { deps: false, storage: false },
      { autoBind: true },
    );
  }

  get activePath(): string | null {
    return this.deps.activePath();
  }

  get active(): RecentWorkspace | null {
    const path = this.activePath;
    if (!path) {
      return null;
    }
    return this.recents.find((entry) => samePath(entry.path, path)) ?? null;
  }

  get label(): string {
    return this.active?.label || workspaceLabel(this.activePath);
  }

  get site(): string | null {
    return this.active?.site ?? null;
  }

  get busy(): boolean {
    return this.activatingPath !== null;
  }

  /** Add or refresh an entry, newest first, capped and deduplicated. */
  remember(entry: {
    path: string;
    label?: string | null;
    site?: string | null;
  }): void {
    const path = entry.path.trim();
    if (!path) {
      return;
    }
    const existing = this.recents.find((item) => samePath(item.path, path));
    const label = entry.label?.trim() || existing?.label || workspaceLabel(path);
    const site = entry.site?.trim() || existing?.site || null;
    const next: RecentWorkspace = {
      path,
      label,
      site,
      openedAt: new Date().toISOString(),
    };
    this.recents = [
      next,
      ...this.recents.filter((item) => !samePath(item.path, path)),
    ].slice(0, MAX_RECENT_WORKSPACES);
    writeStorage(this.storage, this.recents);
  }

  forget(path: string): void {
    const next = this.recents.filter((item) => !samePath(item.path, path));
    if (next.length === this.recents.length) {
      return;
    }
    this.recents = next;
    writeStorage(this.storage, this.recents);
  }

  clear(): void {
    this.recents = [];
    this.error = null;
    writeStorage(this.storage, this.recents);
  }

  /**
   * Switch the active workspace through the existing settings command, then
   * reload the shell and stats. A status path that disagrees with the request
   * is a failure: the UI must not claim a workspace it is not showing.
   */
  async activate(path: string): Promise<WorkspaceActivation> {
    const requested = path.trim();
    if (!requested) {
      this.error = failure("WORKSPACE_NOT_ACTIVATED", "No config path was provided.");
      return { ok: false, error: this.error };
    }
    if (samePath(requested, this.activePath)) {
      this.remember({ path: requested });
      this.error = null;
      return { ok: true, error: null };
    }
    this.activatingPath = requested;
    this.error = null;
    try {
      await this.deps.setConfigPath(requested);
      await this.deps.reloadShell();
      if (!samePath(requested, this.deps.activePath())) {
        this.error = failure(
          "WORKSPACE_NOT_ACTIVATED",
          "The shell did not switch to the requested config path.",
        );
        return { ok: false, error: this.error };
      }
      this.remember({ path: requested });
      if (!this.deps.configMissing()) {
        await this.deps.refreshStats();
      }
      return { ok: true, error: null };
    } catch (error) {
      this.error = toAppError(error, "WORKSPACE_ACTIVATE_FAILED");
      return { ok: false, error: this.error };
    } finally {
      this.activatingPath = null;
    }
  }
}
