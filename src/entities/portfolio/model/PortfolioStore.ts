import { makeAutoObservable } from "mobx";
import type { Envelope } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";
import {
  PORTFOLIO_LIMIT_DEFAULT,
  PORTFOLIO_LIMIT_MAX,
  mapPortfolioList,
  mapPortfolioMeta,
  normalizePortfolioRoot,
  readStoredRoot,
  sessionStorage,
  writeStoredRoot,
  type PortfolioMeta,
  type PortfolioSite,
  type StorageLike,
} from "./types";
import { listPortfolio, type PortfolioListArgs } from "../lib/ipc";

export type PortfolioState = "idle" | "loading" | "ready" | "error";

export type PortfolioListFn = (
  args: PortfolioListArgs,
) => Promise<Envelope<unknown>>;

/**
 * Page-local multi-site roll-up. The store never scans the filesystem itself:
 * `portfolio_list` walks the chosen root in the engine, and every per-site
 * failure stays attached to its row instead of failing the whole list.
 */
export class PortfolioStore {
  state: PortfolioState = "idle";
  root: string | null;
  sites: PortfolioSite[] = [];
  meta: PortfolioMeta | null = null;
  warnings: string[] = [];
  limitations: string[] = [];
  skipped = 0;
  error: AppError | null = null;
  lastLoadedAt: string | null = null;

  private generation = 0;
  private readonly list: PortfolioListFn;
  private readonly storage: StorageLike | null;
  private readonly now: () => Date;

  constructor(
    list: PortfolioListFn = listPortfolio,
    storage: StorageLike | null = sessionStorage(),
    now: () => Date = () => new Date(),
  ) {
    this.list = list;
    this.storage = storage;
    this.now = now;
    this.root = readStoredRoot(storage);
    makeAutoObservable<
      PortfolioStore,
      "generation" | "list" | "storage" | "now"
    >(
      this,
      { generation: false, list: false, storage: false, now: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  get hasSites(): boolean {
    return this.sites.length > 0;
  }

  get issueTotal(): number {
    return this.sites.reduce(
      (sum, site) => sum + (site.issues.total ?? 0),
      0,
    );
  }

  get errorCount(): number {
    return this.sites.filter((site) => site.error !== null).length;
  }

  /** Sites whose issue counters the engine could not read. */
  get issueUnknownCount(): number {
    return this.sites.filter((site) => site.issues.total === null).length;
  }

  get truncated(): boolean {
    return this.meta?.truncated === true;
  }

  get total(): number {
    return this.meta?.total ?? this.sites.length + this.skipped;
  }

  /**
   * Choose a new portfolio root. Changing it invalidates the previous rows and
   * any in-flight response, so a slow scan of the old folder cannot repaint
   * the table after the user picked another one.
   */
  setRoot(value: string | null): void {
    const next = normalizePortfolioRoot(value);
    if (next === this.root) {
      return;
    }
    this.root = next;
    if (next) {
      writeStoredRoot(this.storage, next);
    }
    this.generation += 1;
    this.sites = [];
    this.meta = null;
    this.warnings = [];
    this.limitations = [];
    this.skipped = 0;
    this.error = null;
    this.lastLoadedAt = null;
    this.state = "idle";
  }

  /**
   * Scan the root. A failed refresh keeps the previous rows visible together
   * with the error; a failed first scan shows only the error.
   */
  async load(
    root: string | null = this.root,
    limit = PORTFOLIO_LIMIT_DEFAULT,
  ): Promise<boolean> {
    const requested = normalizePortfolioRoot(root);
    if (!requested) {
      this.error = {
        code: "PORTFOLIO_ROOT_MISSING",
        message: "Choose a folder before listing the portfolio.",
        retryable: false,
      };
      this.state = "error";
      return false;
    }
    if (requested !== this.root) {
      this.setRoot(requested);
    }
    const generation = ++this.generation;
    const bounded = Math.min(
      PORTFOLIO_LIMIT_MAX,
      Math.max(1, Math.trunc(limit)),
    );
    this.state = "loading";
    this.error = null;
    const result = await this.list({ root: requested, limit: bounded });
    if (generation !== this.generation) {
      return false;
    }
    if (!result.ok) {
      this.warnings = result.warnings;
      this.error = toAppError(result.error, "CLI_FAILED");
      this.state = "error";
      return false;
    }
    const mapping = mapPortfolioList(result.data);
    if (!mapping) {
      this.warnings = result.warnings;
      this.error = {
        code: "INVALID_PORTFOLIO_RESULT",
        message: "portfolio_list returned no site array",
        retryable: false,
      };
      this.state = "error";
      return false;
    }
    const meta = mapPortfolioMeta(
      result.meta,
      mapping.sites.length,
      mapping.skipped,
    );
    this.sites = mapping.sites;
    this.meta = meta;
    this.limitations = meta.limitations;
    this.skipped = mapping.skipped;
    this.warnings = result.warnings;
    this.lastLoadedAt = this.now().toISOString();
    this.state = "ready";
    return true;
  }

  refresh(): Promise<boolean> {
    return this.load(this.root);
  }
}
