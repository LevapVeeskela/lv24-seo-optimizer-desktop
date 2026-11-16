import { useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import type { CrawlStore } from "@/entities/crawl";
import { appErrorText, type AppError } from "@/shared/lib/errors";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Notice } from "@/shared/ui/Notice";
import type { CrawlCopy } from "../model/copy";
import { exportCrawl, type CrawlExportFormat } from "../lib/export";

export const CrawlExportPanel = observer(function CrawlExportPanel({
  copy,
  store,
  exportDir,
}: {
  copy: CrawlCopy;
  store: CrawlStore;
  exportDir: string | null;
}) {
  const [exporting, setExporting] = useState<CrawlExportFormat | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    // A new crawl invalidates the previous export path and its error.
    setSavedPath(null);
    setError(null);
    setExporting(null);
  }, [store.result]);

  const runExport = async (format: CrawlExportFormat) => {
    if (!store.result || store.loading) {
      return;
    }
    setExporting(format);
    setSavedPath(null);
    setError(null);
    const outcome = await exportCrawl({
      format,
      result: store.result,
      raw: store.raw,
      meta: store.meta,
      warnings: store.warnings,
      exportDir,
    });
    setExporting(null);
    if (outcome.status === "exported" && outcome.path) {
      setSavedPath(outcome.path);
      return;
    }
    setError(
      outcome.error ?? {
        code: "EXPORT_WRITE",
        message: copy.exportFailed,
        retryable: false,
      },
    );
  };

  const disabled = !store.result || store.loading;

  return (
    <Card>
      <div className="card-header">
        <div>
          <h2>{copy.exportTitle}</h2>
          <p className="muted small">{copy.exportHint}</p>
        </div>
        <div className="badge-row">
          <Button
            variant="secondary"
            loading={exporting === "json"}
            disabled={disabled || exporting !== null}
            onClick={() => void runExport("json")}
          >
            {exporting === "json" ? copy.exporting : copy.exportJson}
          </Button>
          <Button
            variant="secondary"
            loading={exporting === "csv"}
            disabled={disabled || exporting !== null}
            onClick={() => void runExport("csv")}
          >
            {exporting === "csv" ? copy.exporting : copy.exportCsv}
          </Button>
        </div>
      </div>

      {savedPath ? (
        <Notice variant="info">
          <span>
            {copy.exportedTo}: <code>{savedPath}</code>
          </span>
        </Notice>
      ) : null}

      {error ? (
        <Notice variant="error">
          <strong>{copy.exportFailed}</strong>
          <span>
            {error.code === "EXPORT_DIR_UNAVAILABLE"
              ? copy.exportNoRoot
              : appErrorText(error)}
          </span>
        </Notice>
      ) : null}
    </Card>
  );
});
