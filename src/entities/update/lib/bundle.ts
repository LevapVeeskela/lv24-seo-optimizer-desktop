const PORTABLE_ENGINE_SOURCES = new Set(["sibling", "bundled-flat"]);
// We ship NSIS on Windows; MSI installers are not produced, so an MSI install
// cannot be replaced by the NSIS updater package.
const MANUAL_BUNDLE_KINDS = new Set(["deb", "rpm", "msi", "unknown"]);

/**
 * Portable ZIP layouts place the engine next to the executable or flatten it
 * into the resource directory. Neither can replace the running app bundle.
 */
export function isPortableEngineSource(
  source: string | null | undefined,
): boolean {
  return source
    ? PORTABLE_ENGINE_SOURCES.has(source.trim().toLowerCase())
    : false;
}

export function normalizeBundleKind(
  kind: string | null | undefined,
): string {
  return kind?.trim().toLowerCase() || "unknown";
}

/**
 * `null` means the shell has not reported a bundle type yet (older shell or
 * before bootstrap), so the store keeps the updater usable. An explicit
 * `unknown`, `deb`, `rpm` or `msi` disables in-app installation.
 */
export function bundleSupportsAutoUpdate(
  kind: string | null | undefined,
): boolean {
  if (kind === null || kind === undefined || kind.trim() === "") {
    return true;
  }
  return !MANUAL_BUNDLE_KINDS.has(normalizeBundleKind(kind));
}
