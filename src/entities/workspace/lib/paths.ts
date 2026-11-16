/**
 * Path helpers for the onboarding wizard and the recent-workspace list.
 * They only build and compare strings; the shell remains the authority that
 * validates and canonicalizes a path before it is used.
 */

export interface ProjectPaths {
  configPath: string;
  dataDir: string;
}

/** Join a directory and a child name while preserving the input separator. */
export function joinPath(directory: string, name: string): string {
  const trimmed = directory.trim();
  if (!trimmed) {
    return name;
  }
  const withoutTrailing = trimmed.replace(/[\\/]+$/, "");
  if (!withoutTrailing) {
    // A POSIX root ("/") loses everything to the trailing-slash strip.
    return `${trimmed.slice(0, 1)}${name}`;
  }
  const separator =
    withoutTrailing.includes("\\") || /^[a-z]:$/i.test(withoutTrailing)
      ? "\\"
      : "/";
  return `${withoutTrailing}${separator}${name}`;
}

/** `seo.toml` and `data/` always live directly inside the chosen folder. */
export function deriveProjectPaths(directory: string): ProjectPaths {
  return {
    configPath: joinPath(directory, "seo.toml"),
    dataDir: joinPath(directory, "data"),
  };
}

/** Human label for a workspace: the folder that owns `seo.toml`. */
export function workspaceLabel(configPath: string | null | undefined): string {
  const value = configPath?.trim();
  if (!value) {
    return "";
  }
  const normalized = value.replace(/[\\/]+$/, "");
  const lastSeparator = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  const parent = lastSeparator > 0 ? normalized.slice(0, lastSeparator) : normalized;
  const parentSeparator = Math.max(
    parent.lastIndexOf("/"),
    parent.lastIndexOf("\\"),
  );
  const name =
    parentSeparator >= 0 ? parent.slice(parentSeparator + 1) : parent;
  return name || normalized;
}

/** Display host for a site URL or a GSC `sc-domain:` property. */
export function siteLabel(site: string | null | undefined): string | null {
  const value = site?.trim();
  if (!value) {
    return null;
  }
  if (value.toLowerCase().startsWith("sc-domain:")) {
    return value.slice("sc-domain:".length).trim() || null;
  }
  try {
    const url = new URL(value);
    return url.hostname || value;
  } catch {
    return value;
  }
}

function comparablePath(path: string): { value: string; windows: boolean } {
  const value = path.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/");
  const windows = /^[a-z]:\//i.test(value) || value.startsWith("//");
  return { value: windows ? value.toLowerCase() : value, windows };
}

/**
 * Compare two paths the way the shell would on the current platform. A
 * Windows-style path compares case-insensitively; POSIX stays case-sensitive.
 */
export function samePath(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left?.trim() || !right?.trim()) {
    return false;
  }
  const a = comparablePath(left);
  const b = comparablePath(right);
  if (a.windows || b.windows) {
    return a.value.toLowerCase() === b.value.toLowerCase();
  }
  return a.value === b.value;
}
