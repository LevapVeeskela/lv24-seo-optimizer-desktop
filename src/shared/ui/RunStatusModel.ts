export type RunDurationSource = "engine" | "measured";

/**
 * Outcome of one long CLI call. `durationMs` prefers the engine's
 * `meta.duration_ms`; otherwise it is the wall time measured in the app, and
 * `durationSource` tells the UI which one it shows.
 */
export interface RunSummary {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  durationSource: RunDurationSource;
  ok: boolean;
  truncated: boolean;
  limitations: string[];
}

export interface RunSummaryInput {
  startedAt: number;
  finishedAt: number;
  meta: Record<string, unknown>;
  ok: boolean;
  truncated: boolean;
  limitations: string[];
}

function durationValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** `meta.duration_ms` when the engine reported it; `null` otherwise. */
export function durationFromMeta(meta: Record<string, unknown>): number | null {
  return durationValue(meta.duration_ms);
}

export function buildRunSummary(input: RunSummaryInput): RunSummary {
  const engineDuration = durationFromMeta(input.meta);
  const measured = Math.max(0, input.finishedAt - input.startedAt);
  const limitations = [
    ...new Set(
      input.limitations.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      ),
    ),
  ];
  return {
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: engineDuration ?? measured,
    durationSource: engineDuration === null ? "measured" : "engine",
    ok: input.ok,
    truncated: input.truncated,
    limitations,
  };
}

/** Compact, locale-neutral duration: "850 ms", "3.4 s", "1 min 12 s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  const rounded = Math.round(ms);
  if (rounded < 1000) {
    return `${rounded} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
}
