import { DEFAULT_WINDOW, type WindowParams } from "@/entities/window";
import { cliRun } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";
import {
  buildRunSummary,
  type RunSummary,
} from "@/shared/ui/RunStatusModel";
import { makeAutoObservable } from "mobx";
import type { StatsData, StatsService } from "./types";

export type StatsState = "idle" | "loading" | "ready" | "error";

/** Injectable clock so wall-time durations are testable. */
export interface StatsDeps {
  now?: () => number;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function truncatedService(service: StatsService): boolean {
  return service.truncated === true;
}

export class StatsStore {
  state: StatsState = "idle";
  data: StatsData | null = null;
  meta: Record<string, unknown> = {};
  warnings: string[] = [];
  error: AppError | null = null;
  lastUpdated: string | null = null;

  /** Epoch ms of the in-flight run; `null` when idle. */
  startedAt: number | null = null;
  /** Duration, truncation and limitations of the last completed run. */
  lastRun: RunSummary | null = null;
  /** Window the last run actually requested. */
  lastParams: WindowParams | null = null;

  private generation = 0;
  private readonly now: () => number;

  constructor(deps: StatsDeps = {}) {
    this.now = deps.now ?? Date.now;
    makeAutoObservable<StatsStore, "generation" | "now">(
      this,
      { generation: false, now: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  get hasData(): boolean {
    return this.data !== null;
  }

  /**
   * `stats` accepts the reporting window as `--days/--lag-days`; the shell
   * validates both ranges before spawning the engine. Callers pass the shared
   * window so the UI preview and the request cannot disagree. An omitted
   * window keeps the engine default (7 days, lag 2) and sends no flags, so
   * bootstrap and other screens keep their existing contract.
   */
  async refresh(params?: WindowParams): Promise<boolean> {
    const generation = ++this.generation;
    const requested = params ?? DEFAULT_WINDOW;
    this.state = "loading";
    this.error = null;
    this.lastParams = requested;
    const startedAt = this.now();
    this.startedAt = startedAt;
    const result = params
      ? await cliRun<StatsData>("stats", {
          args: { days: params.days, lagDays: params.lagDays },
        })
      : await cliRun<StatsData>("stats");
    if (generation !== this.generation) {
      return false;
    }
    this.startedAt = null;
    const data = result.ok ? result.data : null;
    this.lastRun = buildRunSummary({
      startedAt,
      finishedAt: this.now(),
      meta: result.meta,
      ok: result.ok,
      truncated:
        result.meta.truncated === true ||
        (data?.services ?? []).some(truncatedService),
      limitations: [
        ...stringList(result.meta.limitations),
        ...(data?.limitations ?? []),
      ],
    });
    if (result.ok) {
      this.data = result.data;
      this.meta = result.meta;
      this.warnings = result.warnings;
      this.lastUpdated = new Date().toISOString();
      this.state = "ready";
      return true;
    }
    this.error = toAppError(result.error, "CLI_FAILED");
    this.warnings = result.warnings;
    this.state = "error";
    return false;
  }

  /**
   * Drop everything that belongs to the previous workspace. Bumping the
   * generation also discards a refresh that is still in flight.
   */
  reset(): void {
    this.generation += 1;
    this.state = "idle";
    this.data = null;
    this.meta = {};
    this.warnings = [];
    this.error = null;
    this.lastUpdated = null;
    this.startedAt = null;
    this.lastRun = null;
    this.lastParams = null;
  }
}
