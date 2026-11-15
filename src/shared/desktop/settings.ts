import { invoke } from "@tauri-apps/api/core";

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

/**
 * Persist the selected `seo.toml`. The shell only accepts the already-active
 * path or one the native dialog returned from `pick_config`.
 */
export async function setDesktopConfigPath(
  configPath: string,
): Promise<DesktopSettingsResponse> {
  return invoke<DesktopSettingsResponse>("settings_set", {
    settings: { configPath },
  });
}
