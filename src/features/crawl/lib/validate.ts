/** Blank is valid: the engine falls back to the project base_url. */
export function isValidStartUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  try {
    const url = new URL(trimmed);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== ""
    );
  } catch {
    return false;
  }
}

/** Blank is valid: the engine uses `crawl.max_urls` from seo.toml. */
export function isValidMaxUrls(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  if (!/^\d+$/.test(trimmed)) {
    return false;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 10_000;
}
