import { formatNumber } from "@/shared/lib/format";

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Human byte size; an unknown value stays `—` instead of becoming `0 B`. */
export function formatBytes(value: number | null, locale: string): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "—";
  }
  if (value < 1024) {
    return `${formatNumber(value, locale)} B`;
  }
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${formatNumber(size, locale, 1)} ${UNITS[unit]}`;
}
