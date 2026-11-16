import { invoke } from "@tauri-apps/api/core";

/**
 * Native folder picker owned by the shell. Returns the chosen project
 * directory (not a file) or `null` when the user cancels. The shell validates
 * the directory before the wizard derives `<dir>/seo.toml` and `<dir>/data`.
 */
export async function pickDirectory(): Promise<string | null> {
  const selected = await invoke<string | null>("pick_directory");
  return typeof selected === "string" && selected.trim() ? selected : null;
}
