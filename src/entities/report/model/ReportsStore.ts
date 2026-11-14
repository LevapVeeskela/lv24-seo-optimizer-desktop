import { cliRun } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";
import { makeAutoObservable } from "mobx";
import type { ReportMeta, WeeklyReport } from "./types";

export type ReportsState = "idle" | "loading" | "ready" | "error";

export class ReportsStore {
  state: ReportsState = "idle";
  report: WeeklyReport | null = null;
  meta: ReportMeta = {};
  warnings: string[] = [];
  error: AppError | null = null;
  builtAt: string | null = null;
  private generation = 0;

  constructor() {
    makeAutoObservable<ReportsStore, "generation">(
      this,
      { generation: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  get hasReport(): boolean {
    return this.report !== null;
  }

  /**
   * `report_weekly` persists a local snapshot. The shell allow-list owns the
   * write classification; the UI never passes arbitrary flags.
   */
  async buildWeekly(): Promise<boolean> {
    const generation = ++this.generation;
    this.state = "loading";
    this.error = null;
    const result = await cliRun<WeeklyReport>("report_weekly");
    if (generation !== this.generation) {
      return false;
    }
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
  }
}
