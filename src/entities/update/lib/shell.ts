import { invoke } from "@tauri-apps/api/core";

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
