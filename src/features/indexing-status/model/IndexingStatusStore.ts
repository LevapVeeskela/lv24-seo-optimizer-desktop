import { makeAutoObservable } from "mobx";
import { defaultScheduleTarget } from "@/entities/integrations";
import { toAppError, type AppError } from "@/shared/lib/errors";
import {
  runIndexingHistory,
  runIndexingStatus,
  runScheduleStatus,
} from "../lib/ipc";
import {
  aggregateRunsByDay,
  isUnknownEngineError,
  normalizeIndexingHistory,
  normalizeIndexingStatus,
  normalizeScheduleStatus,
  recentTotals,
  type IndexingDayBucket,
  type IndexingHistoryReport,
  type IndexingProvider,
  type IndexingProviderStatus,
  type IndexingRun,
  type IndexingStatusReport,
  type ScheduleStatusReport,
} from "./types";

export type IndexingStatusState = "idle" | "loading" | "ready" | "error";

/** Rows per provider in the status read and runs in the history read. */
export const INDEXING_STATUS_LIMIT = 50;
export const INDEXING_HISTORY_LIMIT = 30;

export interface IndexingProviderRow {
  provider: IndexingProvider;
  entry: IndexingProviderStatus | null;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.trim() !== ""))];
}

/**
 * Read-only indexing automation card. It loads the queue snapshot, the run
 * history and the host scheduler state together; there is no write path, no
 * confirm token and no `--allow-write` argument.
 *
 * A generation guard drops an answer that belongs to a previous workspace or
 * to a superseded refresh.
 */
export class IndexingStatusStore {
  state: IndexingStatusState = "idle";
  status: IndexingStatusReport | null = null;
  history: IndexingHistoryReport | null = null;
  schedule: ScheduleStatusReport | null = null;
  warnings: string[] = [];
  error: AppError | null = null;
  historyError: AppError | null = null;
  scheduleError: AppError | null = null;
  /** The engine predates `indexing status`/`schedule status` (0.13.1). */
  engineOutdated = false;

  private generation = 0;
  private loadedPath: string | null = null;

  constructor() {
    makeAutoObservable<IndexingStatusStore, "generation" | "loadedPath">(
      this,
      { generation: false, loadedPath: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  /** Always four rows in a stable order, even when the engine omits one. */
  get providerRows(): IndexingProviderRow[] {
    return (["bing", "yandex", "gsc", "indexnow"] as const).map(
      (provider) => ({
        provider,
        entry: this.status?.providers[provider] ?? null,
      }),
    );
  }

  get lastRun(): IndexingRun | null {
    return this.history?.runs[0] ?? null;
  }

  get dayBuckets(): IndexingDayBucket[] {
    return aggregateRunsByDay(this.history?.runs ?? []);
  }

  get recent7(): {
    runs: number;
    submitted: number | null;
    checked: number | null;
  } {
    return recentTotals(this.history?.runs ?? [], 7);
  }

  get recent30(): {
    runs: number;
    submitted: number | null;
    checked: number | null;
  } {
    return recentTotals(this.history?.runs ?? [], 30);
  }

  /** Every limitation the answer carries, plus envelope warnings. */
  get limitations(): string[] {
    return unique([
      ...(this.status?.limitations ?? []),
      ...(this.history?.limitations ?? []),
      ...(this.schedule?.warnings ?? []),
      ...this.warnings,
    ]);
  }

  /**
   * Load all three reads. `configPath` is required: every command is
   * `requires_config` in the shell allow-list. A refresh during a load is
   * ignored so two generations cannot race on the same card.
   */
  async load(
    configPath: string | null,
    platform: string | null | undefined,
  ): Promise<boolean> {
    if (!configPath) {
      this.reset();
      return false;
    }
    // A refresh of the same workspace is ignored while a read is in flight.
    // A different workspace supersedes the old generation so its answer is
    // dropped instead of being shown under the new project.
    if (this.loading && this.loadedPath === configPath) {
      return false;
    }
    this.loadedPath = configPath;
    const generation = ++this.generation;
    this.state = "loading";
    this.error = null;
    this.historyError = null;
    this.scheduleError = null;
    this.engineOutdated = false;

    const target = defaultScheduleTarget(platform);
    const [statusResult, historyResult, scheduleResult] = await Promise.all([
      runIndexingStatus(
        {
          provider: "all",
          limit: INDEXING_STATUS_LIMIT,
          live: true,
        },
        configPath,
      ),
      runIndexingHistory(INDEXING_HISTORY_LIMIT, configPath),
      runScheduleStatus({ kind: "indexing", target }, configPath),
    ]);

    if (generation !== this.generation) {
      return false;
    }

    const warnings = unique([
      ...statusResult.warnings,
      ...historyResult.warnings,
      ...scheduleResult.warnings,
    ]);

    if (!statusResult.ok) {
      this.status = null;
      this.history = null;
      this.schedule = null;
      this.warnings = warnings;
      this.engineOutdated = isUnknownEngineError(statusResult.error.code);
      this.error = toAppError(statusResult.error, "CLI_FAILED");
      this.state = "error";
      return false;
    }

    this.status = normalizeIndexingStatus(
      statusResult.data,
      statusResult.meta,
    );
    this.warnings = warnings;

    if (historyResult.ok) {
      this.history = normalizeIndexingHistory(
        historyResult.data,
        historyResult.meta,
      );
      this.historyError = null;
    } else {
      this.history = null;
      this.historyError = toAppError(historyResult.error, "CLI_FAILED");
    }

    if (scheduleResult.ok) {
      this.schedule = normalizeScheduleStatus(
        scheduleResult.data,
        scheduleResult.meta,
      );
      this.scheduleError = null;
    } else {
      this.schedule = null;
      this.scheduleError = toAppError(scheduleResult.error, "CLI_FAILED");
    }

    this.error = null;
    this.state = "ready";
    return true;
  }

  /** Drop everything that belongs to the previous workspace. */
  reset(): void {
    this.generation += 1;
    this.loadedPath = null;
    this.state = "idle";
    this.status = null;
    this.history = null;
    this.schedule = null;
    this.warnings = [];
    this.error = null;
    this.historyError = null;
    this.scheduleError = null;
    this.engineOutdated = false;
  }
}
