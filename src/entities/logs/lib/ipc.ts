import { invoke } from "@tauri-apps/api/core";
import { cliRun, type Envelope } from "@/shared/cli";

/**
 * The shell owns the file picker: `pick_log_file` returns a path the Rust
 * allow-list already approved, so `logs_analyze` can only read a file the user
 * actually chose. `null` means the dialog was cancelled.
 */
export async function pickLogFile(): Promise<string | null> {
  const selected = await invoke<string | null>("pick_log_file");
  return typeof selected === "string" && selected.trim() ? selected : null;
}

export interface LogsAnalyzeArgs {
  /** Absolute path to one nginx JSON access log. */
  file: string;
  /** Optional UA class filter; omitted analyses every request. */
  bot?: "googlebot" | "yandexbot" | "bingbot" | "other";
}

export function runLogsAnalyze(
  args: LogsAnalyzeArgs,
  runId?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("logs_analyze", {
    args,
    ...(runId ? { runId } : {}),
  });
}
