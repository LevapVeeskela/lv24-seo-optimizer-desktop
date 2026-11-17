import { cliRun, type Envelope } from "@/shared/cli";
import type { IndexingProvider } from "../model/types";

/**
 * Read-only indexing automation reads. The shell allow-list has no write
 * flag, token or provider-side action for these commands; the desktop never
 * offers one.
 */

export interface IndexingStatusArgs {
  provider?: IndexingProvider | "all";
  limit?: number;
  live?: boolean;
}

export function runIndexingStatus(
  args: IndexingStatusArgs = {},
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("indexing_status", {
    args,
    ...(configPath ? { configPath } : {}),
  });
}

export function runIndexingHistory(
  limit?: number,
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("indexing_history", {
    ...(limit ? { args: { limit } } : {}),
    ...(configPath ? { configPath } : {}),
  });
}

export interface ScheduleStatusArgs {
  kind: "indexing" | "weekly" | "daily";
  target?: "windows" | "cron" | "systemd";
}

export function runScheduleStatus(
  args: ScheduleStatusArgs,
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("schedule_status", {
    args,
    ...(configPath ? { configPath } : {}),
  });
}
