/**
 * `shell_status` is owned by the Rust shell and serialized in camelCase.
 * Fields are optional here because the desktop must render an honest
 * "offline/unknown" state when a field is absent instead of assuming a
 * healthy engine.
 */
export interface DesktopInfo {
  name?: string;
  version?: string;
  identifier?: string;
}

export interface EngineInfo {
  found?: boolean;
  version?: string;
  path?: string;
  source?: string;
  minimumVersion?: string;
  compatible?: boolean;
  error?: { code?: string; message?: string } | null;
}

export interface ShellPaths {
  appConfigDir?: string;
  appDataDir?: string;
  logDir?: string;
  /** App-owned export directory accepted by `write_text_file`. */
  exportDir?: string;
}

export interface ShellStatus {
  desktop?: DesktopInfo;
  engine?: EngineInfo;
  configPath?: string | null;
  configExists?: boolean;
  dataDir?: string | null;
  platform?: string;
  arch?: string;
  /** Installed bundle type reported by the shell: deb, rpm, appimage, msi, nsis, app or unknown. */
  bundleKind?: string | null;
  paths?: ShellPaths;
}

export type EngineState = "idle" | "loading" | "ready" | "offline";

export function engineVersion(status: ShellStatus | null): string | null {
  if (!status) {
    return null;
  }
  const version = status.engine?.version ?? null;
  return version?.trim() || null;
}

export function desktopVersion(status: ShellStatus | null): string | null {
  if (!status) {
    return null;
  }
  const version = status.desktop?.version ?? null;
  return version?.trim() || null;
}

/** An engine is usable only when it was found and its version is supported. */
export function engineReady(status: ShellStatus | null): boolean {
  if (!status) {
    return false;
  }
  if (!status.engine) {
    return false;
  }
  if (status.engine.found === false) {
    return false;
  }
  return status.engine.compatible !== false;
}
