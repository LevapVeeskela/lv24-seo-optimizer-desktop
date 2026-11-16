import { DEFAULT_WINDOW, type WindowParams } from "@/entities/window";
import { cliRun } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";
import { buildRunSummary, type RunSummary } from "@/shared/ui/RunStatusModel";
import { makeAutoObservable } from "mobx";
import {
  diffUnavailableReason,
  parseReportDiff,
  type DiffUnavailableReason,
  type ReportDiff,
  type ReportDiffMeta,
} from "./diff";
import { reportLimitations, type ReportMeta, type WeeklyReport } from "./types";

export type ReportsState = "idle" | "loading" | "ready" | "error";
export type DiffState = "idle" | "loading" | "ready" | "empty" | "error";

/** Injectable clock so wall-time durations are testable. */
export interface ReportsDeps {
  now?: () => number;
}

export class ReportsStore {
  state: ReportsState = "idle";
  report: WeeklyReport | null = null;
  meta: ReportMeta = {};
  warnings: string[] = [];
  error: AppError | null = null;
  builtAt: string | null = null;

  /** Epoch ms of the in-flight weekly build; `null` when idle. */
  startedAt: number | null = null;
  /** Duration, truncation and limitations of the last completed build. */
  lastRun: RunSummary | null = null;
  /** Window the last build actually requested. */
  lastParams: WindowParams | null = null;

  diffState: DiffState = "idle";
  diff: ReportDiff | null = null;
  diffMeta: ReportDiffMeta = {};
  diffWarnings: string[] = [];
  diffError: AppError | null = null;
  diffUnavailable: DiffUnavailableReason | null = null;

  private generation = 0;
  private diffGeneration = 0;
  private readonly now: () => number;

  constructor(deps: ReportsDeps = {}) {
    this.now = deps.now ?? Date.now;
    makeAutoObservable<ReportsStore, "generation" | "diffGeneration" | "now">(
      this,
      { generation: false, diffGeneration: false, now: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  get hasReport(): boolean {
    return this.report !== null;
  }

  get diffLoading(): boolean {
    return this.diffState === "loading";
  }

  /**
   * `report_weekly` persists a local snapshot. The shell allow-list owns the
   * write classification; the UI never passes arbitrary flags. `days/lagDays`
   * are the only request knobs and come from the shared window store.
   */
  async buildWeekly(params: WindowParams = DEFAULT_WINDOW): Promise<boolean> {
    const generation = ++this.generation;
    this.state = "loading";
    this.error = null;
    this.lastParams = params;
    const startedAt = this.now();
    this.startedAt = startedAt;
    const result = await cliRun<WeeklyReport>("report_weekly", {
      args: { days: params.days, lagDays: params.lagDays },
    });
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
      truncated: result.meta.truncated === true,
      limitations: reportLimitations(data, result.meta as ReportMeta),
    });
    if (result.ok) {
      this.report = result.data;
      this.meta = result.meta as ReportMeta;
      this.warnings = result.warnings;
      this.builtAt = new Date().toISOString();
      this.state = "ready";
      return true;
    }
    this.error = toAppError(result.error, "CLI_FAILED");
    this.warnings = result.warnings;
    this.state = "error";
    return false;
  }

  /**
   * `report_diff` compares the two newest stored snapshots. The engine decides
   * which periods are comparable, so the UI passes no arguments: a stale
   * `--base/--head` from the webview would bypass its honesty rules.
   *
   * Fewer than two snapshots is not an error: it is the documented empty state
   * with a next step ("build another weekly report").
   */
  async loadDiff(): Promise<boolean> {
    const generation = ++this.diffGeneration;
    this.diffState = "loading";
    this.diffError = null;
    this.diffUnavailable = null;
    const result = await cliRun<unknown>("report_diff");
    if (generation !== this.diffGeneration) {
      return false;
    }
    if (result.ok) {
      const diff = parseReportDiff(result.data);
      if (!diff) {
        this.diff = null;
        this.diffMeta = {};
        this.diffWarnings = result.warnings;
        this.diffError = {
          code: "INVALID_ENVELOPE",
          message: "report_diff returned data without snapshot identities",
          retryable: false,
        };
        this.diffState = "error";
        return false;
      }
      this.diff = diff;
      this.diffMeta = result.meta as ReportDiffMeta;
      this.diffWarnings = result.warnings;
      this.diffState = "ready";
      return true;
    }
    this.diff = null;
    this.diffMeta = result.meta as ReportDiffMeta;
    this.diffWarnings = result.warnings;
    const reason = diffUnavailableReason(result.error);
    if (reason) {
      this.diffUnavailable = reason;
      this.diffState = "empty";
      return false;
    }
    this.diffError = toAppError(result.error, "CLI_FAILED");
    this.diffState = "error";
    return false;
  }

  /**
   * Drop the previous workspace's report. `meta` carries `artifacts.html`, so
   * clearing it also drops the stale report HTML path shown on the page.
   */
  reset(): void {
    this.generation += 1;
    this.state = "idle";
    this.report = null;
    this.meta = {};
    this.warnings = [];
    this.error = null;
    this.builtAt = null;
    this.startedAt = null;
    this.lastRun = null;
    this.lastParams = null;
    this.resetDiff();
  }

  resetDiff(): void {
    this.diffGeneration += 1;
    this.diffState = "idle";
    this.diff = null;
    this.diffMeta = {};
    this.diffWarnings = [];
    this.diffError = null;
    this.diffUnavailable = null;
  }
}
