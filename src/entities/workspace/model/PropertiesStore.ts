import { cliRun } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";
import { makeAutoObservable } from "mobx";
import { mapProperties, type PropertiesView, type PropertyRow } from "../lib/properties";
import { samePath } from "../lib/paths";

export type PropertiesState = "idle" | "loading" | "ready" | "error";

/** Read-only wrapper around `lv24-seo properties --json`. */
export class PropertiesStore {
  state: PropertiesState = "idle";
  path: string | null = null;
  view: PropertiesView | null = null;
  meta: Record<string, unknown> = {};
  warnings: string[] = [];
  error: AppError | null = null;
  lastUpdated: string | null = null;
  private generation = 0;

  constructor() {
    makeAutoObservable<PropertiesStore, "generation">(
      this,
      { generation: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  get hasData(): boolean {
    return this.view !== null;
  }

  get rows(): PropertyRow[] {
    return this.view?.rows ?? [];
  }

  get configuredRows(): PropertyRow[] {
    return this.rows.filter((row) => row.configured);
  }

  get project() {
    return this.view?.project ?? null;
  }

  /**
   * Load properties for `path`. A ready value for the same workspace is reused
   * unless `force` is set, so navigating between pages does not re-run the CLI.
   */
  async load(path: string, force = false): Promise<boolean> {
    if (!path.trim()) {
      return false;
    }
    const sameWorkspace = samePath(path, this.path);
    if (!force && sameWorkspace && (this.state === "loading" || this.state === "ready")) {
      return this.state === "ready";
    }
    const generation = ++this.generation;
    this.state = "loading";
    this.error = null;
    const result = await cliRun<unknown>("properties");
    if (generation !== this.generation) {
      return false;
    }
    if (result.ok) {
      this.path = path;
      this.view = mapProperties(result.data);
      this.meta = result.meta;
      this.warnings = result.warnings;
      this.lastUpdated = new Date().toISOString();
      this.state = "ready";
      return true;
    }
    this.path = path;
    this.error = toAppError(result.error, "CLI_FAILED");
    this.warnings = result.warnings;
    this.state = "error";
    return false;
  }

  async refresh(): Promise<boolean> {
    return this.path ? this.load(this.path, true) : false;
  }

  /** Drop data that belongs to the previous workspace and any in-flight load. */
  reset(): void {
    this.generation += 1;
    this.state = "idle";
    this.path = null;
    this.view = null;
    this.meta = {};
    this.warnings = [];
    this.error = null;
    this.lastUpdated = null;
  }
}
