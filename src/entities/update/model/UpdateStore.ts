import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { makeAutoObservable } from "mobx";
import { toAppError, type AppError } from "@/shared/lib/errors";
import {
  bundleSupportsAutoUpdate,
  normalizeBundleKind,
} from "../lib/bundle";
import { classifyUpdateError } from "../lib/errors";
import type { AvailableUpdate, UpdateState } from "./types";

/** The updater check must not hang the startup probe indefinitely. */
export const UPDATE_CHECK_TIMEOUT_MS = 30_000;

/**
 * Wraps the Tauri updater for the whole window.
 *
 * The store never installs on its own: `check` only announces a release and
 * `install` runs after an explicit click. A silent check is the startup probe;
 * it must not turn an offline machine into an error screen.
 *
 * Portable ZIP builds and Linux deb/rpm packages cannot replace themselves,
 * so they disable checking and installing and point at the release page.
 */
export class UpdateStore {
  state: UpdateState = "idle";
  currentVersion: string | null = null;
  available: AvailableUpdate | null = null;
  /** Download progress as a 0..1 ratio; `null` while the size is unknown. */
  progress: number | null = null;
  error: AppError | null = null;
  lastChecked: string | null = null;
  lastCheckFailed = false;
  isPortable = false;
  /** Installed bundle type from `shell_status.bundleKind`; `null` before bootstrap. */
  bundleKind: string | null = null;
  /** Set after a signature failure; the same artifact is never retried. */
  securityBlocked = false;
  /** Version whose signature failed, if the endpoint identified it. */
  blockedVersion: string | null = null;
  private pending: Update | null = null;
  private generation = 0;

  constructor() {
    makeAutoObservable<UpdateStore, "pending" | "generation">(
      this,
      { pending: false, generation: false },
      { autoBind: true },
    );
  }

  get checking(): boolean {
    return this.state === "checking";
  }

  get downloading(): boolean {
    return this.state === "downloading";
  }

  get canAutoUpdate(): boolean {
    return !this.isPortable && bundleSupportsAutoUpdate(this.bundleKind);
  }

  get canInstall(): boolean {
    return (
      this.pending !== null &&
      this.state !== "checking" &&
      !this.securityBlocked &&
      this.canAutoUpdate
    );
  }

  get percent(): number | null {
    return this.progress === null ? null : Math.round(this.progress * 100);
  }

  /** Portable builds are detected from `shell_status.engine.source`. */
  setPortable(value: boolean): void {
    if (this.isPortable === value) {
      return;
    }
    this.isPortable = value;
    if (!this.canAutoUpdate) {
      this.disableAutoUpdate();
    }
  }

  /** Deb, rpm and explicit `unknown` bundles need a manual package download. */
  setBundleKind(value: string | null | undefined): void {
    const next = normalizeBundleKind(value);
    if (this.bundleKind === next) {
      return;
    }
    this.bundleKind = next;
    if (!this.canAutoUpdate) {
      this.disableAutoUpdate();
    }
  }

  /**
   * Asks the configured endpoint for a newer release.
   *
   * @returns `true` when an update is available. A silent check never throws;
   * offline failures stay quiet, while signature failures remain visible.
   */
  async check({ silent = false }: { silent?: boolean } = {}): Promise<boolean> {
    if (!this.canAutoUpdate) {
      this.state = "idle";
      this.error = null;
      this.lastCheckFailed = false;
      return false;
    }
    const generation = ++this.generation;
    this.state = "checking";
    this.error = null;
    this.lastCheckFailed = false;
    try {
      const currentVersion = await this.loadCurrentVersion();
      const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
      if (generation !== this.generation) {
        await closeUpdate(update);
        return false;
      }
      this.currentVersion = currentVersion;
      this.lastChecked = new Date().toISOString();
      if (!update) {
        this.clearSecurityBlock();
        this.clearAvailable();
        this.state = "idle";
        return false;
      }
      // A different release is a new artifact: allow one verification attempt.
      if (this.blockedVersion && this.blockedVersion !== update.version) {
        this.clearSecurityBlock();
      }
      if (this.securityBlocked && this.blockedVersion === update.version) {
        // Do not re-offer the artifact whose signature already failed.
        await closeUpdate(update);
        this.clearAvailable();
        this.state = "error";
        return false;
      }
      this.replacePending(update);
      this.available = {
        version: update.version,
        date: update.date ?? null,
        notes: update.body ?? null,
      };
      this.progress = null;
      this.state = "available";
      return true;
    } catch (error) {
      if (generation !== this.generation) {
        return false;
      }
      this.lastChecked = new Date().toISOString();
      this.lastCheckFailed = true;
      const kind = classifyUpdateError(error);
      if (kind === "unsupported") {
        // 404 or a manifest without this platform: no package exists yet.
        this.clearAvailable();
        this.error = null;
        this.state = "unsupported";
        return false;
      }
      if (kind === "security") {
        // A bad signature is persistent and must never be downgraded to "offline".
        this.error = securityError(error);
        this.securityBlocked = true;
        this.blockedVersion =
          this.available?.version ?? this.pending?.version ?? null;
        this.state = "error";
        return false;
      }
      if (silent) {
        // Keep what the window already knew; offline is not a user-visible error.
        this.error = null;
        this.state = this.available ? "available" : "idle";
        return false;
      }
      this.error = toAppError(
        error,
        kind === "offline" ? "UPDATE_OFFLINE" : "UPDATE_CHECK",
      );
      this.state = "error";
      return false;
    }
  }

  /**
   * Downloads, verifies and installs the pending release, then relaunches.
   * On Windows the installer exits the app before `relaunch` is reached.
   * Calling it again in the `ready` state only retries the restart.
   */
  async install(): Promise<boolean> {
    if (!this.canAutoUpdate || this.securityBlocked) {
      return false;
    }
    if (this.state === "ready") {
      return this.restart();
    }
    const update = this.pending;
    if (!update) {
      return false;
    }
    const generation = ++this.generation;
    this.state = "downloading";
    this.progress = 0;
    this.error = null;
    let total: number | null = null;
    let downloaded = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (generation !== this.generation) {
          return;
        }
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          this.progress = total && total > 0 ? 0 : null;
          return;
        }
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          this.progress =
            total && total > 0 ? Math.min(downloaded / total, 1) : null;
          return;
        }
        this.progress = 1;
      });
    } catch (error) {
      if (generation !== this.generation) {
        return false;
      }
      this.progress = null;
      if (classifyUpdateError(error) === "security") {
        this.error = securityError(error);
        this.securityBlocked = true;
        this.blockedVersion =
          this.pending?.version ?? this.available?.version ?? this.blockedVersion;
      } else {
        this.error = toAppError(error, "UPDATE_INSTALL");
      }
      this.state = "error";
      return false;
    }
    if (generation !== this.generation) {
      return false;
    }
    this.progress = 1;
    this.state = "ready";
    return this.restart();
  }

  /** Releases the pending update resource and returns the panel to idle. */
  dismiss(): void {
    const update = this.pending;
    this.pending = null;
    this.generation += 1;
    this.available = null;
    this.progress = null;
    // A signature failure is not dismissed by hiding the panel; only a
    // different release version clears the block.
    if (!this.securityBlocked) {
      this.error = null;
      this.state = "idle";
    }
    void closeUpdate(update);
  }

  private disableAutoUpdate(): void {
    this.generation += 1;
    this.clearAvailable();
    this.progress = null;
    this.error = null;
    this.lastCheckFailed = false;
    this.clearSecurityBlock();
    this.state = "idle";
  }

  private clearSecurityBlock(): void {
    this.securityBlocked = false;
    this.blockedVersion = null;
  }

  private async loadCurrentVersion(): Promise<string | null> {
    if (this.currentVersion) {
      return this.currentVersion;
    }
    try {
      return await getVersion();
    } catch {
      // The version label is cosmetic; a missing value must not fail the check.
      return null;
    }
  }

  private async restart(): Promise<boolean> {
    try {
      await relaunch();
      return true;
    } catch (error) {
      // The update is installed; a manual restart still finishes the job.
      this.error = toAppError(error, "UPDATE_RESTART");
      this.state = "ready";
      return false;
    }
  }

  private replacePending(update: Update): void {
    const previous = this.pending;
    this.pending = update;
    if (previous && previous !== update) {
      void closeUpdate(previous);
    }
  }

  private clearAvailable(): void {
    const update = this.pending;
    this.pending = null;
    this.available = null;
    this.progress = null;
    void closeUpdate(update);
  }
}

function securityError(error: unknown): AppError {
  const appError = toAppError(error, "UPDATE_SECURITY");
  return { ...appError, code: "UPDATE_SECURITY", retryable: false };
}

async function closeUpdate(update: Update | null): Promise<void> {
  if (!update) {
    return;
  }
  try {
    await update.close();
  } catch {
    // The backend may already have released the resource after installation.
  }
}
