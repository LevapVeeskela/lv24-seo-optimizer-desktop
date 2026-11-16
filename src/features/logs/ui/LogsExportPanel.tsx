import { useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import type { LogsExportFormat, LogsStore } from "@/entities/logs";
import { appErrorText, type AppError } from "@/shared/lib/errors";
import { useI18n } from "@/shared/i18n";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Notice } from "@/shared/ui/Notice";
import { exportLogs } from "../lib/export";

/**
 * JSON/CSV export for the analysis on screen. Writes go through the shell's
 * allow-listed `write_text_file` into the app export root, so the saved path is
 * real and a refused write is visible instead of silent.
 */
export const LogsExportPanel = observer(function LogsExportPanel({
  store,
  exportDir,
}: {
  store: LogsStore;
  exportDir: string | null;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<LogsExportFormat | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const root = exportDir?.trim() || null;

  useEffect(() => {
    // A new analysis invalidates the previous export path and its error.
    setSavedPath(null);
    setError(null);
    setBusy(null);
  }, [store.result]);

  const run = async (format: LogsExportFormat) => {
    if (!store.result || store.loading) {
      return;
    }
    setBusy(format);
    setSavedPath(null);
    setError(null);
    const outcome = await exportLogs({
      format,
      file: store.file ?? store.meta.file ?? null,
      bot: store.bot,
      result: store.result,
      meta: store.meta,
      warnings: store.warnings,
      generatedAt: store.lastRunAt,
      exportDir: root,
    });
    setBusy(null);
    if (outcome.status === "exported" && outcome.path) {
      setSavedPath(outcome.path);
      return;
    }
    setError(
      outcome.error ?? {
        code: "EXPORT_WRITE",
        message: "The export could not be written.",
        retryable: true,
      },
    );
  };

  const disabled = !store.result || store.loading || busy !== null;

  return (
    <Card>
      <div className="card-header">
        <div>
          <h2>{t("logs.exportTitle")}</h2>
          <p className="muted small">{t("logs.exportHint")}</p>
          {root ? (
            <p className="muted small">
              <code>{root}</code>
            </p>
          ) : null}
        </div>
        <div className="badge-row">
          <Button
            variant="secondary"
            loading={busy === "json"}
            disabled={disabled || !root}
            onClick={() => void run("json")}
          >
            {t("logs.exportJson")}
          </Button>
          <Button
            variant="secondary"
            loading={busy === "csv"}
            disabled={disabled || !root}
            onClick={() => void run("csv")}
          >
            {t("logs.exportCsv")}
          </Button>
        </div>
      </div>

      {!root ? (
        <Notice variant="info">
          <span>{t("logs.exportNoRoot")}</span>
        </Notice>
      ) : null}

      {savedPath ? (
        <Notice variant="info">
          <span>
            {t("logs.exportedTo")}: <code>{savedPath}</code>
          </span>
        </Notice>
      ) : null}

      {error ? (
        <Notice variant="error">
          <strong>{t("logs.exportFailed")}</strong>
          <span>
            {error.code === "EXPORT_DIR_UNAVAILABLE"
              ? t("logs.exportNoRoot")
              : appErrorText(error)}
          </span>
        </Notice>
      ) : null}
    </Card>
  );
});
