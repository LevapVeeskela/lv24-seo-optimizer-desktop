import { cliRun } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";
import { isRecord } from "@/shared/lib/format";
import { trackedCliRun } from "@/shared/run/lib/trackedRun";
import type { RunStore } from "@/shared/run/model/RunStore";
import { makeAutoObservable } from "mobx";
import {
  normalizeCrawlResult,
  type CrawlMeta,
  type CrawlResult,
} from "./types";

export type CrawlState = "idle" | "loading" | "ready" | "error" | "cancelled";

export interface CrawlRunArgs {
  /** Blank means "use the project base_url"; the shell validates the URL. */
  start?: string;
  /** Engine-validated range is 1..10000; blank means the configured budget. */
  maxUrls?: number;
}

/**
 * Page-local crawl state. A failed run keeps the previous result visible
 * together with the error, so a transient engine failure never looks like a
 * clean crawl.
 */
export class CrawlStore {
  state: CrawlState = "idle";
  result: CrawlResult | null = null;
  meta: CrawlMeta = {};
  warnings: string[] = [];
  error: AppError | null = null;
  lastRunAt: string | null = null;
  /** Exact `data` payload, kept for the JSON export. */
  raw: unknown = null;
  private generation = 0;
  private now: () => Date;
  private readonly runs: RunStore | null;

  constructor(
    now: () => Date = () => new Date(),
    runs: RunStore | null = null,
  ) {
    this.now = now;
    this.runs = runs;
    makeAutoObservable<CrawlStore, "generation" | "now" | "raw" | "runs">(
      this,
      { generation: false, now: false, raw: false, runs: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  get hasResult(): boolean {
    return this.result !== null;
  }

  async run(args: CrawlRunArgs = {}): Promise<boolean> {
    const generation = ++this.generation;
    this.state = "loading";
    this.error = null;
    const result = this.runs
      ? await trackedCliRun<unknown>(this.runs, {
          kind: "crawl",
          args,
        })
      : await cliRun<unknown>("crawl", { args });
    if (generation !== this.generation) {
      return false;
    }
    if (!result.ok && result.error.code === "RUN_CANCELLED") {
      this.error = null;
      this.warnings = result.warnings;
      this.state = "cancelled";
      return false;
    }
    if (result.ok) {
      if (!isRecord(result.data)) {
        this.error = {
          code: "INVALID_CRAWL_RESULT",
          message: "crawl returned no data object",
          retryable: false,
        };
        this.warnings = result.warnings;
        this.state = "error";
        return false;
      }
      this.result = normalizeCrawlResult(result.data);
      this.raw = result.data;
      this.meta = result.meta as CrawlMeta;
      this.warnings = result.warnings;
      this.lastRunAt = this.now().toISOString();
      this.state = "ready";
      return true;
    }
    this.error = toAppError(result.error, "CLI_FAILED");
    this.warnings = result.warnings;
    this.state = "error";
    return false;
  }

  /** Drop the previous workspace's crawl before another one can be shown. */
  reset(): void {
    this.generation += 1;
    this.state = "idle";
    this.result = null;
    this.raw = null;
    this.meta = {};
    this.warnings = [];
    this.error = null;
    this.lastRunAt = null;
  }
}
