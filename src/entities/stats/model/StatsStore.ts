import { cliRun } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";
import { makeAutoObservable } from "mobx";
import type { StatsData } from "./types";

export type StatsState = "idle" | "loading" | "ready" | "error";

export class StatsStore {
  state: StatsState = "idle";
  data: StatsData | null = null;
  meta: Record<string, unknown> = {};
  warnings: string[] = [];
  error: AppError | null = null;
  lastUpdated: string | null = null;
  private generation = 0;

  constructor() {
    makeAutoObservable<StatsStore, "generation">(
      this,
      { generation: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  get hasData(): boolean {
    return this.data !== null;
  }

  async refresh(): Promise<boolean> {
    const generation = ++this.generation;
    this.state = "loading";
    this.error = null;
    const result = await cliRun<StatsData>("stats");
    if (generation !== this.generation) {
      return false;
    }
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
}
