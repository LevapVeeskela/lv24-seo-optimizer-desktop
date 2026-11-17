import { makeAutoObservable } from "mobx";
import type { Envelope } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";
import {
  runBingCrawl,
  runBingJoins,
  runBingPages,
  runBingTraffic,
  runBingUrlinfo,
  runCwvAudits,
  runCwvHistory,
  runGscInspect,
  runGscSitemaps,
  runMetrikaBytime,
  runMetrikaCountries,
  runMetrikaDevices,
  runMetrikaEngagement,
  runMetrikaGoals,
  runMetrikaPages,
  runYandexIndexing,
  runYandexQueue,
  runYandexSitemaps,
  type MetrikaReadInput,
} from "../lib/ipc";
import {
  isBingTarget,
  isBoundedInt,
  isHttpUrl,
  isIsoDateRange,
} from "../lib/validation";
import {
  normalizeBingCrawl,
  normalizeBingJoins,
  normalizeBingPages,
  normalizeBingTraffic,
  normalizeBingUrlInfo,
  normalizeCwvAudits,
  normalizeCwvHistory,
  normalizeGscInspection,
  normalizeGscSitemaps,
  normalizeMetrikaBytime,
  normalizeMetrikaCountries,
  normalizeMetrikaDevices,
  normalizeMetrikaEngagement,
  normalizeMetrikaGoals,
  normalizeMetrikaPages,
  normalizeYandexIndexing,
  normalizeYandexQueue,
  normalizeYandexSitemaps,
  withEnvelopeMeta,
  type BingCrawlRow,
  type BingJoinRow,
  type BingPageRow,
  type BingStatsReport,
  type BingTrafficRow,
  type BingUrlInfo,
  type CwvAuditsReport,
  type CwvHistoryReport,
  type GscInspection,
  type GscSitemapsReport,
  type MetrikaBytimeReport,
  type MetrikaEngagementReport,
  type MetrikaGoalsReport,
  type MetrikaTableReport,
  type YandexIndexingReport,
  type YandexQueueReport,
  type YandexSitemapsReport,
} from "../model/types";

export type SlotStatus = "idle" | "loading" | "loaded" | "error";

/**
 * One read-only report slot. A load keeps the previous report visible until
 * the new answer arrives; a stale answer from a superseded call is dropped so
 * a slow provider response cannot overwrite a newer one.
 */
export class ReportSlot<T> {
  status: SlotStatus = "idle";
  report: T | null = null;
  warnings: string[] = [];
  error: AppError | null = null;
  private generation = 0;
  private readonly normalize: (value: unknown) => T;

  constructor(normalize: (value: unknown) => T) {
    this.normalize = normalize;
    makeAutoObservable<ReportSlot<T>, "generation" | "normalize">(
      this,
      { generation: false, normalize: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.status === "loading";
  }

  async load(request: () => Promise<Envelope<unknown>>): Promise<boolean> {
    const generation = ++this.generation;
    this.status = "loading";
    this.error = null;
    const result = await request();
    if (generation !== this.generation) {
      return false;
    }
    if (result.ok) {
      this.report = this.normalize(
        withEnvelopeMeta(result.data, result.meta),
      );
      this.warnings = result.warnings;
      this.status = "loaded";
      return true;
    }
    this.error = toAppError(result.error, "CLI_FAILED");
    this.warnings = result.warnings;
    this.status = "error";
    return false;
  }

  /** Local validation failure; the engine is never called. */
  fail(error: AppError): false {
    this.generation += 1;
    this.status = "error";
    this.report = null;
    this.warnings = [];
    this.error = error;
    return false;
  }

  reset(): void {
    this.generation += 1;
    this.status = "idle";
    this.report = null;
    this.warnings = [];
    this.error = null;
  }
}

export type MetrikaGroup = "day" | "week" | "month";
export type CwvStrategy = "mobile" | "desktop";
export type CwvDevice = "phone" | "desktop" | "tablet";
export type CwvCategory =
  | "performance"
  | "seo"
  | "accessibility"
  | "best-practices";
export type CwvTargetMode = "url" | "origin";

const CONFIG_REQUIRED: AppError = {
  code: "CONFIG_PATH_REQUIRED",
  message: "Open a workspace before running platform diagnostics.",
  retryable: false,
};

function invalid(code: string, message: string): AppError {
  return { code, message, retryable: false };
}

/**
 * Read-only diagnostics store: one slot per engine command plus the form state
 * that builds its arguments. Nothing here writes provider or local state.
 */
export class DiagnosticsStore {
  // Google
  gscUrl = "";
  gscLanguage = "en-US";
  gscSitemapIndex = "";
  readonly gscInspect = new ReportSlot<GscInspection>(normalizeGscInspection);
  readonly gscSitemaps = new ReportSlot<GscSitemapsReport>(
    normalizeGscSitemaps,
  );

  // Yandex
  yandexFrom = "";
  yandexTo = "";
  yandexLimit = 100;
  yandexOffset = 0;
  yandexParentId = "";
  readonly yandexIndexing = new ReportSlot<YandexIndexingReport>(
    normalizeYandexIndexing,
  );
  readonly yandexSitemaps = new ReportSlot<YandexSitemapsReport>(
    normalizeYandexSitemaps,
  );
  readonly yandexQueue = new ReportSlot<YandexQueueReport>(
    normalizeYandexQueue,
  );

  // Bing
  bingUrl = "";
  bingQuery = "";
  bingPage = "";
  readonly bingPages = new ReportSlot<BingStatsReport<BingPageRow>>(
    normalizeBingPages,
  );
  readonly bingTraffic = new ReportSlot<BingStatsReport<BingTrafficRow>>(
    normalizeBingTraffic,
  );
  readonly bingCrawl = new ReportSlot<BingStatsReport<BingCrawlRow>>(
    normalizeBingCrawl,
  );
  readonly bingUrlinfo = new ReportSlot<BingStatsReport<BingUrlInfo>>(
    normalizeBingUrlInfo,
  );
  readonly bingJoins = new ReportSlot<BingStatsReport<BingJoinRow>>(
    normalizeBingJoins,
  );

  // Metrika
  metrikaDays = 7;
  metrikaLagDays = 2;
  metrikaLimit = 100;
  metrikaGroup: MetrikaGroup = "day";
  readonly metrikaPages = new ReportSlot<MetrikaTableReport>(
    normalizeMetrikaPages,
  );
  readonly metrikaGoals = new ReportSlot<MetrikaGoalsReport>(
    normalizeMetrikaGoals,
  );
  readonly metrikaDevices = new ReportSlot<MetrikaTableReport>(
    normalizeMetrikaDevices,
  );
  readonly metrikaCountries = new ReportSlot<MetrikaTableReport>(
    normalizeMetrikaCountries,
  );
  readonly metrikaEngagement = new ReportSlot<MetrikaEngagementReport>(
    normalizeMetrikaEngagement,
  );
  readonly metrikaBytime = new ReportSlot<MetrikaBytimeReport>(
    normalizeMetrikaBytime,
  );

  // Core Web Vitals
  cwvUrl = "";
  cwvStrategy: CwvStrategy = "mobile";
  cwvCategories: CwvCategory[] = ["performance", "seo"];
  cwvTargetMode: CwvTargetMode = "url";
  cwvHistoryUrl = "";
  cwvHistoryOrigin = "";
  cwvDevice: CwvDevice | "all" = "phone";
  cwvWeeks = 25;
  readonly cwvAudits = new ReportSlot<CwvAuditsReport>(normalizeCwvAudits);
  readonly cwvHistory = new ReportSlot<CwvHistoryReport>(
    normalizeCwvHistory,
  );

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  // -- Google --------------------------------------------------------------

  async loadGscInspect(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.gscInspect.fail(CONFIG_REQUIRED);
    }
    const url = this.gscUrl.trim();
    if (!isHttpUrl(url)) {
      return this.gscInspect.fail(
        invalid("INVALID_URL", "Enter an absolute http(s) URL to inspect."),
      );
    }
    const language = this.gscLanguage.trim();
    return this.gscInspect.load(() =>
      runGscInspect(
        { url, ...(language ? { language } : {}) },
        configPath,
      ),
    );
  }

  async loadGscSitemaps(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.gscSitemaps.fail(CONFIG_REQUIRED);
    }
    const sitemapIndex = this.gscSitemapIndex.trim();
    if (sitemapIndex !== "" && !isHttpUrl(sitemapIndex)) {
      return this.gscSitemaps.fail(
        invalid(
          "INVALID_SITEMAP_URL",
          "The sitemap index must be an absolute http(s) URL.",
        ),
      );
    }
    return this.gscSitemaps.load(() =>
      runGscSitemaps(
        { ...(sitemapIndex ? { sitemapIndex } : {}) },
        configPath,
      ),
    );
  }

  // -- Yandex --------------------------------------------------------------

  async loadYandexIndexing(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.yandexIndexing.fail(CONFIG_REQUIRED);
    }
    if (!isIsoDateRange(this.yandexFrom, this.yandexTo)) {
      return this.yandexIndexing.fail(
        invalid(
          "INVALID_DATE_RANGE",
          "Use YYYY-MM-DD dates with the start on or before the end.",
        ),
      );
    }
    return this.yandexIndexing.load(() =>
      runYandexIndexing(
        {
          ...(this.yandexFrom ? { dateFrom: this.yandexFrom } : {}),
          ...(this.yandexTo ? { dateTo: this.yandexTo } : {}),
        },
        configPath,
      ),
    );
  }

  async loadYandexSitemaps(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.yandexSitemaps.fail(CONFIG_REQUIRED);
    }
    if (!isBoundedInt(this.yandexLimit, 1, 500)) {
      return this.yandexSitemaps.fail(
        invalid("INVALID_LIMIT", "Limit must be an integer between 1 and 500."),
      );
    }
    const parentId = this.yandexParentId.trim();
    return this.yandexSitemaps.load(() =>
      runYandexSitemaps(
        {
          ...(parentId ? { parentId } : {}),
          limit: this.yandexLimit,
        },
        configPath,
      ),
    );
  }

  async loadYandexQueue(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.yandexQueue.fail(CONFIG_REQUIRED);
    }
    if (!isBoundedInt(this.yandexLimit, 1, 500)) {
      return this.yandexQueue.fail(
        invalid("INVALID_LIMIT", "Limit must be an integer between 1 and 500."),
      );
    }
    if (!isBoundedInt(this.yandexOffset, 0, 1_000_000)) {
      return this.yandexQueue.fail(
        invalid("INVALID_OFFSET", "Offset must be a non-negative integer."),
      );
    }
    if (!isIsoDateRange(this.yandexFrom, this.yandexTo)) {
      return this.yandexQueue.fail(
        invalid(
          "INVALID_DATE_RANGE",
          "Use YYYY-MM-DD dates with the start on or before the end.",
        ),
      );
    }
    return this.yandexQueue.load(() =>
      runYandexQueue(
        {
          limit: this.yandexLimit,
          offset: this.yandexOffset,
          ...(this.yandexFrom ? { dateFrom: this.yandexFrom } : {}),
          ...(this.yandexTo ? { dateTo: this.yandexTo } : {}),
        },
        configPath,
      ),
    );
  }

  // -- Bing ----------------------------------------------------------------

  async loadBingPages(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.bingPages.fail(CONFIG_REQUIRED);
    }
    return this.bingPages.load(() => runBingPages(configPath));
  }

  async loadBingTraffic(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.bingTraffic.fail(CONFIG_REQUIRED);
    }
    return this.bingTraffic.load(() => runBingTraffic(configPath));
  }

  async loadBingCrawl(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.bingCrawl.fail(CONFIG_REQUIRED);
    }
    return this.bingCrawl.load(() => runBingCrawl(configPath));
  }

  async loadBingUrlinfo(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.bingUrlinfo.fail(CONFIG_REQUIRED);
    }
    const url = this.bingUrl.trim();
    if (!isBingTarget(url)) {
      return this.bingUrlinfo.fail(
        invalid(
          "INVALID_URL",
          "Enter an absolute http(s) URL or domain:<host>.",
        ),
      );
    }
    return this.bingUrlinfo.load(() => runBingUrlinfo({ url }, configPath));
  }

  async loadBingJoins(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.bingJoins.fail(CONFIG_REQUIRED);
    }
    const query = this.bingQuery.trim();
    const page = this.bingPage.trim();
    if (query === "" && page === "") {
      return this.bingJoins.fail(
        invalid(
          "INVALID_JOIN",
          "Enter a query, a page, or both to read one Bing join.",
        ),
      );
    }
    if (page !== "" && !isBingTarget(page)) {
      return this.bingJoins.fail(
        invalid(
          "INVALID_PAGE",
          "The page must be an absolute http(s) URL or domain:<host>.",
        ),
      );
    }
    return this.bingJoins.load(() =>
      runBingJoins(
        {
          ...(query ? { query } : {}),
          ...(page ? { page } : {}),
        },
        configPath,
      ),
    );
  }

  // -- Metrika -------------------------------------------------------------

  private metrikaInput(includeLimit: boolean): MetrikaReadInput | AppError {
    if (!isBoundedInt(this.metrikaDays, 1, 3660)) {
      return invalid("INVALID_DAYS", "Days must be an integer between 1 and 3660.");
    }
    if (!isBoundedInt(this.metrikaLagDays, 0, 30)) {
      return invalid(
        "INVALID_LAG",
        "Lag days must be an integer between 0 and 30.",
      );
    }
    if (includeLimit && !isBoundedInt(this.metrikaLimit, 1, 500)) {
      return invalid(
        "INVALID_LIMIT",
        "Limit must be an integer between 1 and 500.",
      );
    }
    return {
      days: this.metrikaDays,
      lagDays: this.metrikaLagDays,
      ...(includeLimit ? { limit: this.metrikaLimit } : {}),
    };
  }

  private metrikaGuard<T>(
    slot: ReportSlot<T>,
    includeLimit = true,
  ): MetrikaReadInput | null {
    const input = this.metrikaInput(includeLimit);
    if ("code" in input) {
      slot.fail(input);
      return null;
    }
    return input;
  }

  async loadMetrikaPages(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.metrikaPages.fail(CONFIG_REQUIRED);
    }
    const input = this.metrikaGuard(this.metrikaPages);
    if (!input) {
      return false;
    }
    return this.metrikaPages.load(() => runMetrikaPages(input, configPath));
  }

  async loadMetrikaGoals(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.metrikaGoals.fail(CONFIG_REQUIRED);
    }
    const input = this.metrikaGuard(this.metrikaGoals);
    if (!input) {
      return false;
    }
    return this.metrikaGoals.load(() => runMetrikaGoals(input, configPath));
  }

  async loadMetrikaDevices(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.metrikaDevices.fail(CONFIG_REQUIRED);
    }
    const input = this.metrikaGuard(this.metrikaDevices);
    if (!input) {
      return false;
    }
    return this.metrikaDevices.load(() => runMetrikaDevices(input, configPath));
  }

  async loadMetrikaCountries(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.metrikaCountries.fail(CONFIG_REQUIRED);
    }
    const input = this.metrikaGuard(this.metrikaCountries);
    if (!input) {
      return false;
    }
    return this.metrikaCountries.load(() =>
      runMetrikaCountries(input, configPath),
    );
  }

  async loadMetrikaEngagement(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.metrikaEngagement.fail(CONFIG_REQUIRED);
    }
    const input = this.metrikaGuard(this.metrikaEngagement, false);
    if (!input) {
      return false;
    }
    return this.metrikaEngagement.load(() =>
      runMetrikaEngagement(input, configPath),
    );
  }

  async loadMetrikaBytime(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.metrikaBytime.fail(CONFIG_REQUIRED);
    }
    const input = this.metrikaGuard(this.metrikaBytime, false);
    if (!input) {
      return false;
    }
    return this.metrikaBytime.load(() =>
      runMetrikaBytime({ ...input, group: this.metrikaGroup }, configPath),
    );
  }

  // -- Core Web Vitals -----------------------------------------------------

  toggleCwvCategory(category: CwvCategory, enabled: boolean): void {
    const next = new Set(this.cwvCategories);
    if (enabled) {
      next.add(category);
    } else {
      next.delete(category);
    }
    this.cwvCategories = [...next];
  }

  async loadCwvAudits(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.cwvAudits.fail(CONFIG_REQUIRED);
    }
    const url = this.cwvUrl.trim();
    if (!isHttpUrl(url)) {
      return this.cwvAudits.fail(
        invalid("INVALID_URL", "Enter an absolute http(s) URL for Lighthouse."),
      );
    }
    if (this.cwvCategories.length === 0) {
      return this.cwvAudits.fail(
        invalid(
          "INVALID_CATEGORY",
          "Select at least one Lighthouse category.",
        ),
      );
    }
    return this.cwvAudits.load(() =>
      runCwvAudits(
        {
          url,
          strategy: this.cwvStrategy,
          category: this.cwvCategories,
        },
        configPath,
      ),
    );
  }

  async loadCwvHistory(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      return this.cwvHistory.fail(CONFIG_REQUIRED);
    }
    const target =
      this.cwvTargetMode === "url"
        ? this.cwvHistoryUrl.trim()
        : this.cwvHistoryOrigin.trim();
    if (!isHttpUrl(target)) {
      return this.cwvHistory.fail(
        invalid(
          "INVALID_URL",
          this.cwvTargetMode === "url"
            ? "Enter an absolute http(s) page URL."
            : "Enter an absolute http(s) origin URL.",
        ),
      );
    }
    if (!isBoundedInt(this.cwvWeeks, 1, 40)) {
      return this.cwvHistory.fail(
        invalid("INVALID_WEEKS", "Weeks must be an integer between 1 and 40."),
      );
    }
    return this.cwvHistory.load(() =>
      runCwvHistory(
        {
          ...(this.cwvTargetMode === "url"
            ? { url: target }
            : { origin: target }),
          ...(this.cwvDevice === "all" ? {} : { device: this.cwvDevice }),
          weeks: this.cwvWeeks,
        },
        configPath,
      ),
    );
  }

  /** Drop every report and form value (workspace switch or unmount). */
  reset(): void {
    this.gscUrl = "";
    this.gscLanguage = "en-US";
    this.gscSitemapIndex = "";
    this.yandexFrom = "";
    this.yandexTo = "";
    this.yandexLimit = 100;
    this.yandexOffset = 0;
    this.yandexParentId = "";
    this.bingUrl = "";
    this.bingQuery = "";
    this.bingPage = "";
    this.metrikaDays = 7;
    this.metrikaLagDays = 2;
    this.metrikaLimit = 100;
    this.metrikaGroup = "day";
    this.cwvUrl = "";
    this.cwvStrategy = "mobile";
    this.cwvCategories = ["performance", "seo"];
    this.cwvTargetMode = "url";
    this.cwvHistoryUrl = "";
    this.cwvHistoryOrigin = "";
    this.cwvDevice = "phone";
    this.cwvWeeks = 25;
    for (const slot of [
      this.gscInspect,
      this.gscSitemaps,
      this.yandexIndexing,
      this.yandexSitemaps,
      this.yandexQueue,
      this.bingPages,
      this.bingTraffic,
      this.bingCrawl,
      this.bingUrlinfo,
      this.bingJoins,
      this.metrikaPages,
      this.metrikaGoals,
      this.metrikaDevices,
      this.metrikaCountries,
      this.metrikaEngagement,
      this.metrikaBytime,
      this.cwvAudits,
      this.cwvHistory,
    ]) {
      slot.reset();
    }
  }
}
