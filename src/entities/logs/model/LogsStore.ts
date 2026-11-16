import { toAppError, type AppError } from "@/shared/lib/errors";
import { isRecord } from "@/shared/lib/format";
import { makeAutoObservable } from "mobx";
import {
  normalizeLogsResult,
  type LogBot,
  type LogsMeta,
  type LogsResult,
} from "./types";
import {
  runLogsAnalyze,
  type LogsAnalyzeArgs,
} from "../lib/ipc";

export type LogsState = "idle" | "loading" | "ready" | "error";

export type LogsAnalyzeFn = (
  args: LogsAnalyzeArgs,
) => ReturnType<typeof runLogsAnalyze>;

/**
 * Page-local log-analysis state. The picked file is kept even when a run fails,
 * and a failed rerun keeps the previous result visible together with the error,
 * so a transient engine failure never looks like an empty log.
 */
export class LogsStore {
  state: LogsState = "idle";
  /** Absolute path chosen through the shell picker; never typed by hand. */
  file: string | null = null;
  /** UA class filter sent to the engine; `null` analyses every request. */
  bot: LogBot | null = null;
  result: LogsResult | null = null;
  meta: LogsMeta = {};
  warnings: string[] = [];
  error: AppError | null = null;
  lastRunAt: string | null = null;
  /** Exact `data` payload, kept for debugging and parity with other stores. */
  raw: unknown = null;
  private generation = 0;
  private readonly analyze: LogsAnalyzeFn;
  private readonly now: () => Date;

  constructor(
    analyze: LogsAnalyzeFn = runLogsAnalyze,
    now: () => Date = () => new Date(),
  ) {
    this.analyze = analyze;
    this.now = now;
    makeAutoObservable<
      LogsStore,
      "generation" | "analyze" | "now" | "raw"
    >(
      this,
      { generation: false, analyze: false, now: false, raw: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  get hasResult(): boolean {
    return this.result !== null;
  }

  /** Picking another file invalidates the previous analysis and its export. */
  setFile(file: string | null): void {
    const next = file?.trim() || null;
    if (next === this.file) {
      return;
    }
    this.file = next;
    this.generation += 1;
    this.result = null;
    this.raw = null;
    this.meta = {};
    this.warnings = [];
    this.error = null;
    this.lastRunAt = null;
    this.state = "idle";
  }

  setBot(bot: LogBot | null): void {
    this.bot = bot;
  }

  async run(): Promise<boolean> {
    if (!this.file) {
      this.error = {
        code: "LOG_FILE_MISSING",
        message: "Choose a log file before running the analysis.",
        retryable: false,
      };
      this.state = "error";
      return false;
    }
    const generation = ++this.generation;
    this.state = "loading";
    this.error = null;
    const args: LogsAnalyzeArgs = { file: this.file };
    if (this.bot) {
      args.bot = this.bot;
    }
    const result = await this.analyze(args);
    if (generation !== this.generation) {
      return false;
    }
    if (result.ok) {
      if (!isRecord(result.data)) {
        this.error = {
          code: "INVALID_LOGS_RESULT",
          message: "logs_analyze returned no data object",
          retryable: false,
        };
        this.warnings = result.warnings;
        this.state = "error";
        return false;
      }
      this.result = normalizeLogsResult(result.data);
      this.raw = result.data;
      this.meta = result.meta as LogsMeta;
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

  /** Drop the analysis and any in-flight run (workspace switch or unmount). */
  reset(): void {
    this.generation += 1;
    this.state = "idle";
    this.file = null;
    this.bot = null;
    this.result = null;
    this.raw = null;
    this.meta = {};
    this.warnings = [];
    this.error = null;
    this.lastRunAt = null;
  }
}
