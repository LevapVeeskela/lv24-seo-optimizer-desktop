import type { ReportMeta, WeeklyReport } from "@/entities/report/model/types";
import { writeTextFile } from "@/shared/desktop/files";
import { toAppError, type AppError } from "@/shared/lib/errors";
import {
  buildReportCsv,
  buildReportExportJson,
  joinExportPath,
  reportExportFilename,
  type ReportExportFormat,
} from "../model/reportExport";

export interface ReportExportResult {
  status: "saved" | "failed";
  format: ReportExportFormat;
  /** Absolute path reported by the shell after the atomic write. */
  path?: string;
  error?: AppError;
}

function failure(
  format: ReportExportFormat,
  error: AppError,
): ReportExportResult {
  return { status: "failed", format, error };
}

/**
 * Write one report export through the shell's `write_text_file`, which only
 * accepts the app export root. No save dialog: the destination is predictable
 * (`<exportDir>/weekly-report-<period>.<ext>`) and the saved path is shown.
 *
 * Never throws: a rejected path or a dead disk becomes a typed failure so the
 * page can render the reason next to the buttons.
 */
export async function exportReportFile(
  report: WeeklyReport | null,
  meta: ReportMeta,
  format: ReportExportFormat,
  options: { exportDir?: string | null } = {},
): Promise<ReportExportResult> {
  const root = options.exportDir?.trim() ?? "";
  if (!root) {
    return failure(format, {
      code: "EXPORT_ROOT_UNKNOWN",
      message:
        "The desktop shell did not report its export folder, so nothing was written.",
      retryable: true,
    });
  }
  if (!report) {
    return failure(format, {
      code: "REPORT_MISSING",
      message: "Build a weekly report before exporting it.",
      retryable: false,
    });
  }
  try {
    const content =
      format === "csv"
        ? buildReportCsv(report, meta)
        : buildReportExportJson(report, meta);
    const target = joinExportPath(root, reportExportFilename(report, format));
    const written = await writeTextFile(target, content);
    return { status: "saved", format, path: written.path || target };
  } catch (error) {
    return failure(format, toAppError(error, "EXPORT_WRITE"));
  }
}
