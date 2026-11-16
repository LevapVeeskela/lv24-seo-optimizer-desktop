import { useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n } from "@/shared/i18n";
import { appErrorText, toAppError, type AppError } from "@/shared/lib/errors";
import { formatDateTime } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { useFeedback } from "@/shared/ui/Feedback";
import { openPath } from "@/entities/config";
import { ReportSectionView } from "@/entities/report/ui/ReportSectionView";
import {
  activePeriod,
  sameWindowParams,
  useWindowSettings,
} from "@/entities/window";
import { ReportExportPanel } from "@/features/export";
import { RunStatus } from "@/shared/ui/RunStatus";
import { WindowPicker } from "@/shared/ui/WindowPicker";
import {
  reportHtmlPath,
  reportLimitations,
  reportSections,
} from "@/entities/report/model/types";
import { isDigestSection, reportDigestSection } from "@/entities/report/model/digest";
import {
  isCwvLimitation,
  isCwvSection,
  reportCwvSection,
} from "@/entities/report/model/cwv";
import { ReportDiffCard } from "./ReportDiffCard";
import { ReportDigestCard } from "./ReportDigestCard";
import { ReportCwvCard } from "./ReportCwvCard";

export const ReportsPage = observer(function ReportsPage() {
  const { t, locale } = useI18n();
  const { engine, reports, runs } = useRootStore();
  const { notify } = useFeedback();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<AppError | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const configPath = engine.status?.configPath ?? null;
  const windowSettings = useWindowSettings(configPath);
  const windowPeriod = activePeriod(windowSettings.days, windowSettings.lagDays);
  const windowStale =
    reports.lastParams !== null &&
    !sameWindowParams(reports.lastParams, windowSettings.params);
  const blocked = engine.offline || engine.loading || !configPath;
  const activeRun = runs.activeFor("reportWeekly");

  const report = reports.report;
  const meta = reports.meta;
  const htmlPath = reportHtmlPath(meta);
  const digestSection = reportDigestSection(report);
  const cwvSection = reportCwvSection(report);
  // The digest and CWV have their own compact cards; neither is an "unknown
  // section", so the generic section list must not render them twice.
  const sections = reportSections(report).filter((section) => {
    const candidate: unknown = section;
    return !isDigestSection(candidate) && !isCwvSection(candidate);
  });
  const limitations = reportLimitations(report, meta);
  // CWV caveats belong to the CWV card, but only when that card actually
  // renders; otherwise they stay in the generic limitations list.
  const cwvLimitations = cwvSection
    ? limitations.filter(isCwvLimitation)
    : [];
  const reportLimitationsRest = cwvSection
    ? limitations.filter((item) => !isCwvLimitation(item))
    : limitations;
  const warnings = [
    ...new Set([...(report?.warnings ?? []), ...reports.warnings]),
  ].filter((item) => typeof item === "string" && item.trim());

  useEffect(() => {
    // A report from another workspace must not keep an open error from the
    // previous HTML path.
    setOpenError(null);
  }, [htmlPath]);

  useEffect(() => {
    // `report_diff` reads the local snapshot store only, so the comparison is
    // available right after a restart, without rebuilding (which would move
    // the head snapshot).
    if (!blocked && reports.diffState === "idle") {
      void reports.loadDiff();
    }
  }, [blocked, reports, reports.diffState]);

  const buildWeekly = async () => {
    if (blocked || reports.loading) {
      return;
    }
    const ok = await reports.buildWeekly(windowSettings.params);
    if (ok) {
      // The fresh snapshot is the head side of the comparison; reload it so
      // the card never compares against a superseded report.
      void reports.loadDiff();
      notify(t("reports.built"), "success");
      return;
    }
    // A cancelled build is not a provider failure and gets no error toast; the
    // page notice and the run banner carry the distinct cancelled state.
    if (reports.state !== "cancelled") {
      notify(
        reports.error ? appErrorText(reports.error) : t("reports.buildFailed"),
        "error",
      );
    }
  };

  const compare = async () => {
    if (blocked) {
      return;
    }
    const ok = await reports.loadDiff();
    if (!ok && reports.diffError) {
      notify(appErrorText(reports.diffError), "error");
    }
  };

  const reconnect = async () => {
    await engine.load();
  };

  const openHtml = async () => {
    if (!htmlPath) {
      return;
    }
    setOpening(true);
    setOpenError(null);
    try {
      // The shell's `open_path` validates the path against approved roots;
      // the plugin-opener command is not in the window capability.
      await openPath(htmlPath);
    } catch (error) {
      setOpenError(toAppError(error, "OPEN_PATH"));
    } finally {
      setOpening(false);
    }
  };

  const requestBuild = () => setConfirmOpen(true);

  const resetWindow = () => {
    windowSettings.reset();
    notify(t("window.resetDone"));
  };

  const period = report?.period ?? meta.period;
  const property = report?.property_id ?? meta.property_id;

  const diffCard = (
    <ReportDiffCard
      state={reports.diffState}
      diff={reports.diff}
      unavailable={reports.diffUnavailable}
      error={reports.diffError}
      warnings={reports.diffWarnings}
      disabled={blocked}
      onCompare={() => void compare()}
    />
  );

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{t("reports.title")}</h1>
          <p className="muted">{t("reports.subtitle")}</p>
        </div>
        <div className="page-actions">
          <Button
            variant="primary"
            loading={reports.loading}
            onClick={requestBuild}
            disabled={blocked}
          >
            {reports.loading ? t("actions.building") : t("actions.buildWeekly")}
          </Button>
          <Button
            variant="secondary"
            loading={opening}
            disabled={!htmlPath}
            onClick={() => void openHtml()}
          >
            {t("reports.openHtml")}
          </Button>
        </div>
      </header>

      <Card>
        <div className="card-header">
          <div>
            <h2>{t("window.title")}</h2>
            <p className="muted small">{t("window.hint")}</p>
          </div>
        </div>
        <WindowPicker
          days={windowSettings.days}
          lagDays={windowSettings.lagDays}
          period={windowPeriod}
          disabled={blocked}
          stale={windowStale}
          onDaysChange={(days) => windowSettings.setDays(days)}
          onLagChange={(lagDays) => windowSettings.setLagDays(lagDays)}
          onReset={resetWindow}
        />
      </Card>

      <RunStatus
        label={t("runStatus.reportLabel")}
        running={reports.loading}
        startedAt={reports.startedAt}
        lastRun={reports.lastRun}
        cancelling={activeRun?.status === "cancelling"}
        onCancel={
          activeRun ? () => void runs.cancel(activeRun.id) : undefined
        }
      />

      {engine.offline ? (
        <Notice
          variant="info"
          action={
            <Button variant="secondary" onClick={() => void reconnect()}>
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("reports.offlineTitle")}</strong>
          <span>{t("reports.offlineHint")}</span>
        </Notice>
      ) : null}

      {!configPath && !engine.loading && !engine.offline ? (
        <Notice
          variant="info"
          action={
            <Link className="btn btn-secondary" to="/settings">
              {t("reports.openSettings")}
            </Link>
          }
        >
          <strong>{t("reports.noWorkspaceTitle")}</strong>
          <span>{t("reports.noWorkspaceHint")}</span>
        </Notice>
      ) : null}

      {report && !htmlPath ? (
        <Notice variant="info">
          <span>{t("reports.openHtmlUnavailable")}</span>
        </Notice>
      ) : null}

      {openError ? (
        <Notice variant="error">
          <strong>{t("reports.openHtmlError")}</strong>
          <span>{appErrorText(openError)}</span>
        </Notice>
      ) : null}

      {reports.state === "cancelled" ? (
        <Notice
          variant="info"
          action={
            <Button
              variant="secondary"
              onClick={requestBuild}
              disabled={blocked}
            >
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("runStatus.cancelled")}</strong>
          <span>{t("runStatus.cancelledHint")}</span>
        </Notice>
      ) : null}

      {reports.error ? (
        <Notice
          variant="error"
          action={
            <Button
              variant="secondary"
              onClick={requestBuild}
              disabled={blocked}
            >
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("reports.error")}</strong>
          <span>{appErrorText(reports.error)}</span>
        </Notice>
      ) : null}

      {reports.loading && !report ? <Loading label={t("reports.loading")} /> : null}

      {!report && !reports.loading && !blocked ? (
        <Card>
          <EmptyState
            title={t("reports.emptyTitle")}
            hint={t("reports.emptyHint")}
            action={
              <Button variant="primary" onClick={requestBuild}>
                {t("actions.buildWeekly")}
              </Button>
            }
          />
          <p className="muted small reports-build-hint">{t("reports.buildHint")}</p>
        </Card>
      ) : null}

      {!report && !reports.loading && !blocked ? diffCard : null}

      {report ? (
        <>
          <Card className="report-summary">
            <div className="card-header">
              <div>
                <p className="eyebrow">{t("reports.latest")}</p>
                <h2>{report.headline ?? t("common.notAvailable")}</h2>
              </div>
              <div className="badge-row">
                {typeof meta.complete === "boolean" ? (
                  <Badge tone={meta.complete ? "success" : "warning"}>
                    {meta.complete ? t("reports.complete") : t("reports.incomplete")}
                  </Badge>
                ) : null}
                {typeof meta.truncated === "boolean" ? (
                  <Badge tone={meta.truncated ? "warning" : "neutral"}>
                    {meta.truncated
                      ? t("reports.truncated")
                      : t("reports.notTruncated")}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="report-facts">
              {property ? (
                <span>
                  {t("reports.property")}: <code>{property}</code>
                </span>
              ) : null}
              {period ? (
                <span>
                  {t("reports.period")}: {period.start} – {period.end}
                </span>
              ) : null}
              {report.generated_at ? (
                <span>
                  {t("reports.generated")}:{" "}
                  {formatDateTime(report.generated_at, locale)}
                </span>
              ) : null}
              {typeof meta.data_age_days === "number" ? (
                <span>
                  {t("reports.dataAge")}: {meta.data_age_days} d
                </span>
              ) : null}
              {meta.snapshot_hash ? (
                <span>
                  {t("reports.snapshot")}: <code>{meta.snapshot_hash}</code>
                </span>
              ) : null}
            </div>
          </Card>

          {diffCard}

          <ReportDigestCard section={digestSection} />

          <ReportCwvCard section={cwvSection} limitations={cwvLimitations} />

          {sections.length ? (
            sections.map((section, index) => (
              <ReportSectionView
                key={`${section.key}-${index}`}
                section={section}
              />
            ))
          ) : (
            <Card>
              <p className="muted">{t("reports.noSections")}</p>
            </Card>
          )}

          {reportLimitationsRest.length ? (
            <Card>
              <h4>{t("reports.limitations")}</h4>
              <ul className="report-notes">
                {reportLimitationsRest.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {warnings.length ? (
            <Card>
              <h4>{t("reports.warnings")}</h4>
              <ul className="report-notes">
                {warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <ReportExportPanel
            report={report}
            meta={meta}
            exportDir={engine.status?.paths?.exportDir ?? null}
          />
        </>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={t("reports.confirm.title")}
        confirmLabel={t("reports.confirm.confirm")}
        cancelLabel={t("common.cancel")}
        busy={reports.loading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void buildWeekly();
        }}
      >
        <p>{t("reports.confirm.body")}</p>
      </ConfirmDialog>
    </section>
  );
});
