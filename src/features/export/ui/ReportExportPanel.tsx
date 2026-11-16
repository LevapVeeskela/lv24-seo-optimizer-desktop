import { useState } from "react";
import { useI18n } from "@/shared/i18n";
import { appErrorText, type AppError } from "@/shared/lib/errors";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Notice } from "@/shared/ui/Notice";
import type { ReportMeta, WeeklyReport } from "@/entities/report/model/types";
import { fillCopy } from "@/entities/report/model/copy";
import { exportReportFile } from "../lib/exportReport";
import { reportExportCopy } from "../model/copy";
import type { ReportExportFormat } from "../model/reportExport";

/**
 * JSON/CSV export for the report currently on screen. Writes go through the
 * shell's allow-listed `write_text_file` into the app export root, so the
 * saved path is real and a refused write is visible instead of silent.
 */
export function ReportExportPanel({
  report,
  meta,
  exportDir,
}: {
  report: WeeklyReport | null;
  meta: ReportMeta;
  exportDir?: string | null;
}) {
  const { locale } = useI18n();
  const copy = reportExportCopy(locale);
  const [busy, setBusy] = useState<ReportExportFormat | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const root = exportDir?.trim() || null;

  const run = async (format: ReportExportFormat) => {
    setBusy(format);
    setSavedPath(null);
    setError(null);
    const result = await exportReportFile(report, meta, format, {
      exportDir: root,
    });
    setBusy(null);
    if (result.status === "saved" && result.path) {
      setSavedPath(result.path);
      return;
    }
    setError(
      result.error ?? {
        code: "EXPORT_WRITE",
        message: copy.failed,
        retryable: true,
      },
    );
  };

  return (
    <Card className="report-export">
      <div className="card-header">
        <div>
          <h4>{copy.title}</h4>
          <p className="muted small">{copy.hint}</p>
          {root ? (
            <p className="muted small">
              {fillCopy(copy.folder, { path: root })}
            </p>
          ) : null}
        </div>
      </div>

      {!root ? (
        <Notice variant="info">
          <strong>{copy.noFolderTitle}</strong>
          <span>{copy.noFolderHint}</span>
        </Notice>
      ) : null}

      <div className="page-actions">
        <Button
          variant="secondary"
          loading={busy === "json"}
          disabled={!root || !report || busy !== null}
          onClick={() => void run("json")}
        >
          {copy.json}
        </Button>
        <Button
          variant="secondary"
          loading={busy === "csv"}
          disabled={!root || !report || busy !== null}
          onClick={() => void run("csv")}
        >
          {copy.csv}
        </Button>
      </div>
      <p className="muted small">{copy.csvColumns}</p>

      {savedPath ? (
        <p className="muted small" role="status">
          {fillCopy(copy.saved, { path: savedPath })}
        </p>
      ) : null}

      {error ? (
        <Notice variant="error">
          <strong>{copy.failed}</strong>
          <span>{appErrorText(error)}</span>
        </Notice>
      ) : null}
    </Card>
  );
}
