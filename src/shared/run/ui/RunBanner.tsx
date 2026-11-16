import { observer } from "mobx-react-lite";
import { useI18n, type MessageKey } from "@/shared/i18n";
import { Button } from "@/shared/ui/Button";
import { useElapsed } from "@/shared/ui/RunStatus";
import { formatDuration } from "@/shared/ui/RunStatusModel";
import type { RunEntry, RunStore } from "../model/RunStore";
import type { RunKind } from "../model/types";

export const RUN_KIND_KEYS: Record<RunKind, MessageKey> = {
  crawl: "runs.kind.crawl",
  reportWeekly: "runs.kind.reportWeekly",
  logsAnalyze: "runs.kind.logsAnalyze",
  backupCreate: "runs.kind.backupCreate",
  backupRestore: "runs.kind.backupRestore",
  scheduleInstall: "runs.kind.scheduleInstall",
};

const RunBannerRow = observer(function RunBannerRow({
  entry,
  runs,
}: {
  entry: RunEntry;
  runs: RunStore;
}) {
  const { t } = useI18n();
  const running = entry.status === "running";
  const cancelling = entry.status === "cancelling";
  const elapsed = useElapsed(
    entry.startedAt,
    running || cancelling,
  );
  const kind = t(RUN_KIND_KEYS[entry.kind]);

  return (
    <div className={`run-banner run-banner-${entry.status}`}>
      <span className="run-banner-kind">{kind}</span>
      <span
        className="run-banner-state"
        role="status"
        aria-live={running ? "off" : "polite"}
      >
        {running
          ? t("runs.banner.running", { elapsed: formatDuration(elapsed) })
          : null}
        {cancelling ? t("runs.banner.cancelling") : null}
        {entry.status === "cancelled" ? t("runs.banner.cancelled") : null}
      </span>
      {running ? (
        <Button
          variant="danger"
          className="run-banner-action"
          aria-label={t("runs.banner.cancelLabel", { kind })}
          onClick={() => void runs.cancel(entry.id)}
        >
          {t("runs.banner.cancel")}
        </Button>
      ) : null}
      {entry.status === "cancelled" ? (
        <Button
          variant="ghost"
          className="run-banner-action"
          onClick={() => runs.dismiss(entry.id)}
        >
          {t("common.dismiss")}
        </Button>
      ) : null}
    </div>
  );
});

/**
 * Persistent run banner. It is rendered by the app layout, not by a page, so a
 * long call keeps its status and Cancel button while the user navigates. Only
 * commands tracked by the run store appear here; a short read never does.
 */
export const RunBanner = observer(function RunBanner({
  runs,
}: {
  runs: RunStore;
}) {
  const { t } = useI18n();
  const entries = runs.bannerEntries;
  if (entries.length === 0) {
    return null;
  }
  return (
    <div
      className="run-banners"
      role="group"
      aria-label={t("runs.banner.label")}
    >
      {entries.map((entry) => (
        <RunBannerRow key={entry.id} entry={entry} runs={runs} />
      ))}
    </div>
  );
});
