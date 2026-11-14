const numberCache = new Map<string, Intl.NumberFormat>();

function numberFormatter(locale: string, digits: number): Intl.NumberFormat {
  const key = `${locale}:${digits}`;
  const cached = numberCache.get(key);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  numberCache.set(key, formatter);
  return formatter;
}

/** Formats a finite number; unknown values stay unknown instead of becoming 0. */
export function formatNumber(
  value: number | null | undefined,
  locale: string,
  digits = 0,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  return numberFormatter(locale, digits).format(value);
}

export function formatPercent(
  ratio: number | null | undefined,
  locale: string,
  digits = 2,
): string {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) {
    return "—";
  }
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(ratio);
}

export function formatDateTime(
  value: string | null | undefined,
  locale: string,
  timeZone?: string,
): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
