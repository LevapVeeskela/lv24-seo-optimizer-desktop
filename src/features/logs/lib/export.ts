import {
  joinExportPath,
  logsCsv,
  logsExportFilename,
  logsJson,
  type LogsExportFormat,
  type LogsMeta,
  type LogsResult,
} from "@/entities/logs";
import { writeTextFile } from "@/shared/desktop/files";
import { toAppError, type AppError } from "@/shared/lib/errors";

export interface LogsExportInput {
  format: LogsExportFormat;
  /** Absolute log path analysed by the engine. */
  file: string | null;
  /** Bot filter used for the run; `null` means every request. */
  bot: string | null;
  result: LogsResult;
  meta: LogsMeta;
  warnings: readonly string[];
  generatedAt?: string | null;
  exportDir?: string | null;
  now?: Date;
}

export interface LogsExportOutcome {
  status: "exported" | "failed";
  path?: string;
  bytes?: number;
  error?: AppError;
}

/**
 * Write one log export through the shell's `write_text_file`, which only accepts
 * the app export root. The destination is predictable
 * (`<exportDir>/logs-<file>-<timestamp>.<ext>`) and the saved path is returned,
 * so a refused write is visible instead of silent. Never throws.
 */
export async function exportLogs(
  input: LogsExportInput,
): Promise<LogsExportOutcome> {
  const exportDir = input.exportDir?.trim() ?? "";
  if (!exportDir) {
    return {
      status: "failed",
      error: {
        code: "EXPORT_DIR_UNAVAILABLE",
        message: "The app export directory is unavailable.",
        retryable: false,
      },
    };
  }
  const filename = logsExportFilename(
    input.format,
    input.file,
    input.now ?? new Date(),
  );
  const path = joinExportPath(exportDir, filename);
  const content =
    input.format === "json"
      ? logsJson({
          file: input.file,
          bot: input.bot,
          result: input.result,
          meta: input.meta,
          warnings: input.warnings,
          generatedAt: input.generatedAt ?? null,
        })
      : logsCsv(input.result.bot_daily);

  try {
    const saved = await writeTextFile(path, content);
    return { status: "exported", path: saved.path || path, bytes: saved.bytes };
  } catch (error) {
    return { status: "failed", error: toAppError(error, "EXPORT_WRITE") };
  }
}
