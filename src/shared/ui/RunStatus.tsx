import { useEffect, useState } from "react";
import { useI18n } from "@/shared/i18n";
import { formatDateTime } from "@/shared/lib/format";
import { Badge } from "./Badge";
import { formatDuration, type RunSummary } from "./RunStatusModel";

/** Whole seconds since `startedAt`, refreshed once a second while running. */
export function useElapsed(startedAt: number | null, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || startedAt === null) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, startedAt]);
  if (!running || startedAt === null) {
    return 0;
  }
  return Math.max(0, now - startedAt);
}

/**
 * Honest progress for a long stats/report call: live elapsed time, the last
 * run's duration, truncation and limitation badges. 0.4.0 has no cancellation
 * path, so the copy says the call runs to completion instead of showing a
 * button that would do nothing.
 */
export function RunStatus({
  label,
  running,
  startedAt,
  lastRun,
}: {
  label: string;
  running: boolean;
  startedAt: number | null;
  lastRun: RunSummary | null;
}) {
  const { t, locale } = useI18n();
  const elapsed = useElapsed(startedAt, running);
  if (!running && !lastRun) {
    return null;
  }
  const tone = lastRun
    ? lastRun.ok
      ? lastRun.truncated
        ? "run-partial"
        : "run-success"
      : "run-failed"
    : "run-success";
  return (
    <div className="form-actions">
      <span className="muted small">{label}</span>
      {running ? (
        <span className="run-status run-running" aria-live="off">
          {t("runStatus.running", { elapsed: formatDuration(elapsed) })}
        </span>
      ) : null}
      {lastRun ? (
        <span className="badge-row" role="status" aria-live="polite">
          <span className={`run-status ${tone}`}>
            {t("runStatus.lastRun", {
              duration: formatDuration(lastRun.durationMs),
              time: formatDateTime(
                new Date(lastRun.finishedAt).toISOString(),
                locale,
              ),
            })}
          </span>
          <Badge tone={lastRun.truncated ? "warning" : "neutral"}>
            {lastRun.truncated
              ? t("runStatus.truncated")
              : t("runStatus.complete")}
          </Badge>
          {lastRun.limitations.length ? (
            <Badge tone="info">
              {t("runStatus.limitations", {
                count: lastRun.limitations.length,
              })}
            </Badge>
          ) : null}
          {!lastRun.ok ? (
            <Badge tone="danger">{t("runStatus.failed")}</Badge>
          ) : null}
        </span>
      ) : null}
      {running ? (
        <span className="muted small">{t("runStatus.noCancel")}</span>
      ) : null}
      {!running && lastRun?.durationSource === "measured" ? (
        <span className="muted small">{t("runStatus.measuredHint")}</span>
      ) : null}
    </div>
  );
}
