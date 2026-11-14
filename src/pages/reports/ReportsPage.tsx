import { useState } from "react";
import { observer } from "mobx-react-lite";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n } from "@/shared/i18n";
import { toAppError, type AppError } from "@/shared/lib/errors";
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
  reportHtmlPath,
  reportLimitations,
  reportSections,
} from "@/entities/report/model/types";

export const ReportsPage = observer(function ReportsPage() {
  const { t, locale } = useI18n();
  const { reports } = useRootStore();
  const { notify } = useFeedback();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<AppError | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const report = reports.report;
  const meta = reports.meta;
  const htmlPath = reportHtmlPath(meta);
  const sections = reportSections(report);
  const limitations = reportLimitations(report, meta);
  const warnings = [
    ...new Set([...(report?.warnings ?? []), ...reports.warnings]),
  ].filter((item) => typeof item === "string" && item.trim());

  const buildWeekly = async () => {
    const ok = await reports.buildWeekly();
    notify(
      ok ? t("reports.built") : reports.error?.message ?? t("reports.buildFailed"),
      ok ? "success" : "error",
    );
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

  const period = report?.period ?? meta.period;
  const property = report?.property_id ?? meta.property_id;

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

      {!htmlPath ? (
        <Notice variant="info">
          <span>{t("reports.openHtmlUnavailable")}</span>
        </Notice>
      ) : null}

      {openError ? (
        <Notice variant="error">
          <strong>{t("reports.openHtmlError")}</strong>
          <span>{openError.message}</span>
        </Notice>
      ) : null}

      {reports.error ? (
        <Notice
          variant="error"
          action={
            <Button variant="secondary" onClick={requestBuild}>
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("reports.error")}</strong>
          <span>
            {reports.error.message}
            {reports.error.nextAction ? ` ${reports.error.nextAction}` : ""}
          </span>
        </Notice>
      ) : null}

      {reports.loading && !report ? <Loading label={t("reports.loading")} /> : null}

      {!report && !reports.loading ? (
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

          {limitations.length ? (
            <Card>
              <h4>{t("reports.limitations")}</h4>
              <ul className="report-notes">
                {limitations.map((item) => (
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
