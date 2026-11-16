import { useEffect, useState } from "react";
import { useI18n } from "@/shared/i18n";
import { formatDateTime } from "@/shared/lib/format";
import { Badge } from "./Badge";
import { Button } from "./Button";
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
 * run's duration, truncation and limitation badges. A cancellable run also gets
 * a Cancel button; a short read passes no handler and keeps no cancel control.
 */
export function RunStatus({
  label,
  running,
  startedAt,
  lastRun,
  cancelling = false,
  onCancel,
}: {
  label: string;
  running: boolean;
  startedAt: number | null;
  lastRun: RunSummary | null;
  cancelling?: boolean;
  onCancel?: () => void;
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
      {running && onCancel ? (
        <Button
          variant="danger"
          className="run-cancel-button"
          disabled={cancelling}
          onClick={onCancel}
        >
          {cancelling ? t("runStatus.cancelling") : t("runStatus.cancel")}
        </Button>
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
        <span className="muted small">
          {onCancel
            ? t("runStatus.backgroundHint")
            : t("runStatus.readHint")}
        </span>
      ) : null}
      {!running && lastRun?.durationSource === "measured" ? (
        <span className="muted small">{t("runStatus.measuredHint")}</span>
      ) : null}
    </div>
  );
}
