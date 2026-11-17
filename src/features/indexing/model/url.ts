/**
 * Mirrors the Rust argument checks closely enough to keep an invalid value out
 * of IPC. The shell repeats every check; this is convenience, not security.
 */
function hasUnsafeCharacters(value: string): boolean {
  return /[\s\u0000-\u001f\u007f]/.test(value);
}

function parseUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed || hasUnsafeCharacters(trimmed)) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (!url.hostname || url.username || url.password) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/** Absolute `http(s)` URL for a sitemap. */
export function isHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return false;
  }
  const url = parseUrl(trimmed);
  return url?.protocol === "http:" || url?.protocol === "https:";
}

/** Absolute `https` site URL; Site Scan never receives plain http. */
export function isHttpsUrl(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("https://") && parseUrl(trimmed)?.protocol === "https:";
}
