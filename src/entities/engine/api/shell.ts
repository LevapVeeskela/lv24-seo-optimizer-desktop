import { invoke } from "@tauri-apps/api/core";

/**
 * Native workspace picker owned by the shell. The shell opens the dialog and
 * persists the selection before returning it, so the webview never decides
 * which path `config_write`/`config_patch` may touch (SEC-05). Returns `null`
 * when the user cancels.
 */
export async function pickConfig(): Promise<string | null> {
  const selected = await invoke<string | null>("pick_config");
  return typeof selected === "string" && selected.trim() ? selected : null;
}
