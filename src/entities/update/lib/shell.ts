import { invoke } from "@tauri-apps/api/core";

/** Progress event emitted by the Rust updater while a release downloads. */
export const UPDATE_PROGRESS_EVENT = "update://progress";

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

export interface UpdateInstallResult {
  version: string;
  installed: boolean;
}

/**
 * Stops every engine sidecar this app instance spawned and returns how many
 * processes were killed.
 *
 * A live sidecar keeps `engine/lv24-seo/lv24-seo.exe` locked, so the NSIS
 * installer cannot replace it and the installed engine ends up missing. The
 * shell kills only PIDs it tracked itself; it never matches by image name, so
 * another installed copy or an unrelated process is untouched.
 */
export async function prepareForUpdate(): Promise<number> {
  return invoke<number>("prepare_update");
}

/**
 * Downloads, verifies and installs the release the panel announced.
 *
 * The webview has no `updater:download-and-install` permission: the shell
 * re-checks the endpoint, refuses a version that differs from the one the user
 * saw, and emits `update://progress` while it downloads. On Windows the process
 * exits once the installer starts, so the promise may never resolve.
 */
export async function installUpdate(
  expectedVersion: string,
): Promise<UpdateInstallResult> {
  return invoke<UpdateInstallResult>("update_install", { expectedVersion });
}

/**
 * Cancels a running download before the installer starts. Returns `false` when
 * the install is already under way; the update cannot be undone at that point.
 */
export async function cancelUpdateInstall(): Promise<boolean> {
  return invoke<boolean>("update_cancel");
}
