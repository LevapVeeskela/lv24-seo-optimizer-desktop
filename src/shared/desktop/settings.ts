import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface DesktopSettings {
  configPath: string | null;
  uiLocale?: string;
}

export interface DesktopSettingsResponse {
  settings: DesktopSettings;
  path: string;
}

/** Read the shell-owned desktop settings (not the project's seo.toml). */
export async function readDesktopSettings(): Promise<DesktopSettingsResponse> {
  return invoke<DesktopSettingsResponse>("settings_get");
}

/** Persist the selected `seo.toml`; the shell validates that it is absolute. */
export async function setDesktopConfigPath(
  configPath: string,
): Promise<DesktopSettingsResponse> {
  return invoke<DesktopSettingsResponse>("settings_set", {
    settings: { configPath },
  });
}

/**
 * Native file picker for the workspace configuration. Returns `null` when the
 * user cancels; the selected path is persisted before it is returned.
 */
export async function pickConfigFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "seo.toml",
    filters: [{ name: "TOML", extensions: ["toml"] }],
  });
  if (typeof selected !== "string" || !selected.trim()) {
    return null;
  }
  await setDesktopConfigPath(selected);
  return selected;
}
