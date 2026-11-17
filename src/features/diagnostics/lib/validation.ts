/**
 * Mirrors the Rust diagnostics checks closely enough to keep an invalid value
 * out of IPC. The shell repeats every check; this is convenience, not security.
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

/** Absolute `http(s)` URL accepted by the read-only provider commands. */
export function isHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return false;
  }
  const url = parseUrl(trimmed);
  return url?.protocol === "http:" || url?.protocol === "https:";
}

function isHostLike(host: string): boolean {
  return (
    host.length > 0 &&
    host.length <= 253 &&
    !host.startsWith(".") &&
    !host.startsWith("-") &&
    !host.startsWith(":") &&
    !host.endsWith(".") &&
    !host.endsWith("-") &&
    !host.endsWith(":") &&
    /^[A-Za-z0-9._:-]+$/.test(host)
  );
}

/** Bing accepts an absolute URL or `domain:<host>` for URL info and joins. */
export function isBingTarget(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith("domain:")) {
    return isHostLike(trimmed.slice("domain:".length));
  }
  return isHttpUrl(trimmed);
}

/** `YYYY-MM-DD` that names a real calendar day. */
export function isIsoDate(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return false;
  }
  const [year, month, day] = trimmed.split("-").map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isIsoDateRange(from: string, to: string): boolean {
  if (from !== "" && !isIsoDate(from)) {
    return false;
  }
  if (to !== "" && !isIsoDate(to)) {
    return false;
  }
  return from === "" || to === "" || from <= to;
}

export function isBoundedInt(
  value: number,
  min: number,
  max: number,
): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}
