import { makeAutoObservable } from "mobx";
import type { Envelope } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";
import {
  openBingSiteScan,
  runBingIssues,
  runBingQuota,
  runBingSitemaps,
  runBingSubmit,
  runIndexNowSubmit,
  runSitemapSubmit,
  type BingSubmitArgs,
  type IndexNowSubmitArgs,
  type SitemapSubmitArgs,
} from "../lib/ipc";
import {
  indexingErrorHint,
  normalizeBingIssues,
  normalizeBingQuota,
  normalizeBingSitemaps,
  normalizeBingSubmitCounts,
  normalizeIndexingOutcome,
  normalizeIndexingPlan,
  withEnvelopeMeta,
  type BingIssuesReport,
  type BingQuotaReport,
  type BingSitemapsReport,
  type BingSubmitCounts,
  type IndexingOutcome,
  type IndexingPlan,
} from "./types";
import { isHttpUrl, isHttpsUrl } from "./url";

export type IndexingFlowState =
  | "idle"
  | "planning"
  | "planned"
  | "applying"
  | "applied"
  | "error"
  | "cancelled";

export type SiteScanState = "idle" | "opening" | "opened" | "error";

/** Read-only load state; separate from the two-phase write flow states. */
export type BingListState = "idle" | "loading" | "loaded" | "error";

export type SitemapSubmitFn = (
  args: SitemapSubmitArgs,
  configPath?: string,
) => Promise<Envelope<unknown>>;

export type IndexNowSubmitFn = (
  args: IndexNowSubmitArgs,
  configPath?: string,
) => Promise<Envelope<unknown>>;

export type BingSubmitFn = (
  args: BingSubmitArgs,
  configPath?: string,
) => Promise<Envelope<unknown>>;

export type BingReadFn = (configPath?: string) => Promise<Envelope<unknown>>;

export type OpenSiteScanFn = (siteUrl: string) => Promise<string>;

function engineError(error: unknown): AppError {
  return toAppError(error, "CLI_FAILED");
}

/**
 * Bing indexing actions. Sitemap and IndexNow are independent two-phase flows:
 * `planned` is the only state that can ask for confirmation, and only a
 * confirmed request may reach the engine with the write opt-in and token.
 * A cancelled or failed apply drops the plan so the user reviews it again.
 */
export class IndexingStore {
  /** Shared optional sitemap URL; empty means the engine project default. */
  sitemapUrl = "";

  sitemapState: IndexingFlowState = "idle";
  sitemapPlan: IndexingPlan | null = null;
  sitemapOutcome: IndexingOutcome | null = null;
  sitemapWarnings: string[] = [];
  sitemapError: AppError | null = null;
  /** Set only by `requestSitemapApply`; `confirmSitemap` refuses without it. */
  sitemapPending = false;

  indexNowState: IndexingFlowState = "idle";
  indexNowPlan: IndexingPlan | null = null;
  indexNowOutcome: IndexingOutcome | null = null;
  indexNowWarnings: string[] = [];
  indexNowError: AppError | null = null;
  indexNowPending = false;

  /** Raw multi-line URL input; parsed lazily so blank lines are harmless. */
  bingUrlInput = "";
  bingFromSitemap = false;
  bingState: IndexingFlowState = "idle";
  bingPlan: IndexingPlan | null = null;
  bingOutcome: IndexingOutcome | null = null;
  bingPlanCounts: BingSubmitCounts | null = null;
  bingOutcomeCounts: BingSubmitCounts | null = null;
  bingWarnings: string[] = [];
  bingError: AppError | null = null;
  bingPending = false;

  sitemapsState: BingListState = "idle";
  sitemapsReport: BingSitemapsReport | null = null;
  sitemapsWarnings: string[] = [];
  sitemapsError: AppError | null = null;

  issuesState: BingListState = "idle";
  issuesReport: BingIssuesReport | null = null;
  issuesWarnings: string[] = [];
  issuesError: AppError | null = null;

  quotaState: BingListState = "idle";
  quotaReport: BingQuotaReport | null = null;
  quotaWarnings: string[] = [];
  quotaError: AppError | null = null;

  siteUrl = "";
  siteScanState: SiteScanState = "idle";
  siteScanError: AppError | null = null;
  siteScanOpenedUrl: string | null = null;

  private sitemapGeneration = 0;
  private indexNowGeneration = 0;
  private bingGeneration = 0;
  private sitemapsGeneration = 0;
  private issuesGeneration = 0;
  private quotaGeneration = 0;
  private siteScanGeneration = 0;
  private readonly submitSitemap: SitemapSubmitFn;
  private readonly submitIndexNow: IndexNowSubmitFn;
  private readonly submitBing: BingSubmitFn;
  private readonly loadSitemaps: BingReadFn;
  private readonly loadIssues: BingReadFn;
  private readonly loadQuota: BingReadFn;
  private readonly openScan: OpenSiteScanFn;

  constructor(
    submitSitemap: SitemapSubmitFn = runSitemapSubmit,
    submitIndexNow: IndexNowSubmitFn = runIndexNowSubmit,
    openScan: OpenSiteScanFn = openBingSiteScan,
    submitBing: BingSubmitFn = runBingSubmit,
    loadSitemaps: BingReadFn = runBingSitemaps,
    loadIssues: BingReadFn = runBingIssues,
    loadQuota: BingReadFn = runBingQuota,
  ) {
    this.submitSitemap = submitSitemap;
    this.submitIndexNow = submitIndexNow;
    this.submitBing = submitBing;
    this.loadSitemaps = loadSitemaps;
    this.loadIssues = loadIssues;
    this.loadQuota = loadQuota;
    this.openScan = openScan;
    makeAutoObservable<
      IndexingStore,
      | "sitemapGeneration"
      | "indexNowGeneration"
      | "bingGeneration"
      | "sitemapsGeneration"
      | "issuesGeneration"
      | "quotaGeneration"
      | "siteScanGeneration"
      | "submitSitemap"
      | "submitIndexNow"
      | "submitBing"
      | "loadSitemaps"
      | "loadIssues"
      | "loadQuota"
      | "openScan"
    >(
      this,
      {
        sitemapGeneration: false,
        indexNowGeneration: false,
        bingGeneration: false,
        sitemapsGeneration: false,
        issuesGeneration: false,
        quotaGeneration: false,
        siteScanGeneration: false,
        submitSitemap: false,
        submitIndexNow: false,
        submitBing: false,
        loadSitemaps: false,
        loadIssues: false,
        loadQuota: false,
        openScan: false,
      },
      { autoBind: true },
    );
  }

  get sitemapPlanning(): boolean {
    return this.sitemapState === "planning";
  }

  get sitemapApplying(): boolean {
    return this.sitemapState === "applying";
  }

  get sitemapReady(): boolean {
    return (
      this.sitemapState === "planned" &&
      Boolean(this.sitemapPlan?.confirmToken)
    );
  }

  get sitemapNeedsAuth(): boolean {
    return indexingErrorHint(this.sitemapError) === "auth";
  }

  get sitemapNeedsEngineUpdate(): boolean {
    return indexingErrorHint(this.sitemapError) === "engine";
  }

  get indexNowPlanning(): boolean {
    return this.indexNowState === "planning";
  }

  get indexNowApplying(): boolean {
    return this.indexNowState === "applying";
  }

  get indexNowReady(): boolean {
    return (
      this.indexNowState === "planned" &&
      Boolean(this.indexNowPlan?.confirmToken)
    );
  }

  get indexNowNeedsAuth(): boolean {
    return indexingErrorHint(this.indexNowError) === "auth";
  }

  get indexNowNeedsEngineUpdate(): boolean {
    return indexingErrorHint(this.indexNowError) === "engine";
  }

  get bingPlanning(): boolean {
    return this.bingState === "planning";
  }

  get bingApplying(): boolean {
    return this.bingState === "applying";
  }

  get bingReady(): boolean {
    return (
      this.bingState === "planned" && Boolean(this.bingPlan?.confirmToken)
    );
  }

  get bingNeedsAuth(): boolean {
    return indexingErrorHint(this.bingError) === "auth";
  }

  get bingNeedsEngineUpdate(): boolean {
    return indexingErrorHint(this.bingError) === "engine";
  }

  /** Trimmed, non-empty, de-duplicated lines; blank lines never reach IPC. */
  get bingUrls(): string[] {
    const lines = this.bingUrlInput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
    return [...new Set(lines)];
  }

  get bingInvalidUrls(): string[] {
    return this.bingUrls.filter((url) => !isHttpUrl(url));
  }

  get bingSourceReady(): boolean {
    return this.bingUrls.length > 0 || this.bingFromSitemap;
  }

  get bingCanPlan(): boolean {
    return this.bingSourceReady && this.bingInvalidUrls.length === 0;
  }

  get sitemapsLoading(): boolean {
    return this.sitemapsState === "loading";
  }

  get issuesLoading(): boolean {
    return this.issuesState === "loading";
  }

  get quotaLoading(): boolean {
    return this.quotaState === "loading";
  }

  get siteScanOpening(): boolean {
    return this.siteScanState === "opening";
  }

  get siteUrlValid(): boolean {
    return isHttpsUrl(this.siteUrl);
  }

  /** Sitemap URL for IPC; `null` lets the engine use its project default. */
  get sitemapRequestUrl(): string | null {
    const value = this.sitemapUrl.trim();
    return value === "" ? null : value;
  }

  get sitemapUrlInvalid(): boolean {
    const value = this.sitemapRequestUrl;
    return value !== null && !isHttpUrl(value);
  }

  /** Changing the shared sitemap invalidates every plan built from it. */
  setSitemapUrl(value: string): void {
    if (value === this.sitemapUrl) {
      return;
    }
    this.sitemapUrl = value;
    this.invalidateSitemap();
    this.invalidateIndexNow();
    this.invalidateBing();
  }

  setBingUrls(value: string): void {
    if (value === this.bingUrlInput) {
      return;
    }
    this.bingUrlInput = value;
    this.invalidateBing();
  }

  setBingFromSitemap(value: boolean): void {
    if (value === this.bingFromSitemap) {
      return;
    }
    this.bingFromSitemap = value;
    this.invalidateBing();
  }

  setSiteUrl(value: string): void {
    if (value === this.siteUrl) {
      return;
    }
    this.siteUrl = value;
    this.invalidateSiteScan();
  }

  /**
   * Plan phase: no `allowWrite`, no token. A successful plan is the only way
   * `sitemapReady` becomes true.
   */
  async planSitemap(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      this.invalidateSitemap();
      this.sitemapError = {
        code: "CONFIG_PATH_REQUIRED",
        message: "Open a workspace before reviewing a sitemap submit.",
        retryable: false,
      };
      this.sitemapState = "error";
      return false;
    }
    const url = this.sitemapRequestUrl;
    if (url !== null && !isHttpUrl(url)) {
      this.sitemapError = {
        code: "INVALID_SITEMAP_URL",
        message: "Sitemap URL must be an absolute http(s) URL.",
        retryable: false,
      };
      this.sitemapState = "error";
      return false;
    }
    const generation = ++this.sitemapGeneration;
    this.sitemapState = "planning";
    this.sitemapPlan = null;
    this.sitemapOutcome = null;
    this.sitemapPending = false;
    this.sitemapError = null;
    const request: SitemapSubmitArgs = {
      provider: "bing",
      ...(url ? { url } : {}),
      // The engine's write gate requires the explicit opt-in even for a plan;
      // no confirm token is sent, so this only mints a reviewed plan.
      allowWrite: true,
    };
    const result = await this.submitSitemap(request, configPath);
    if (generation !== this.sitemapGeneration) {
      return false;
    }
    if (!result.ok && result.error.code === "RUN_CANCELLED") {
      this.sitemapWarnings = result.warnings;
      this.sitemapState = "cancelled";
      return false;
    }
    if (result.ok) {
      this.sitemapPlan = normalizeIndexingPlan(
        withEnvelopeMeta(result.data, result.meta),
      );
      this.sitemapWarnings = result.warnings;
      this.sitemapState = "planned";
      return true;
    }
    this.sitemapError = engineError(result.error);
    this.sitemapWarnings = result.warnings;
    this.sitemapState = "error";
    return false;
  }

  /** Open the confirmation dialog; never calls the engine. */
  requestSitemapApply(): boolean {
    if (!this.sitemapPlan?.confirmToken) {
      this.sitemapError = {
        code: "INDEXING_TOKEN_MISSING",
        message:
          "The plan has no confirmation token, so it cannot be submitted.",
        retryable: false,
      };
      return false;
    }
    if (!this.sitemapReady) {
      this.sitemapError = {
        code: "INDEXING_NOT_READY",
        message: "Review the sitemap plan before submitting it.",
        retryable: false,
      };
      return false;
    }
    this.sitemapPending = true;
    return true;
  }

  cancelSitemapApply(): void {
    this.sitemapPending = false;
  }

  /**
   * Apply phase. The explicit `requestSitemapApply` is the confirmation gate: a
   * direct call without it is refused before the engine sees the token.
   */
  async confirmSitemap(configPath: string | null): Promise<boolean> {
    if (!this.sitemapPending) {
      this.sitemapError = {
        code: "INDEXING_NOT_CONFIRMED",
        message: "Confirm the sitemap submit in the dialog before applying it.",
        retryable: false,
      };
      return false;
    }
    this.sitemapPending = false;
    const token = this.sitemapPlan?.confirmToken ?? null;
    const url = this.sitemapRequestUrl;
    if (!token || !configPath || (url !== null && !isHttpUrl(url))) {
      this.sitemapError = {
        code: "INDEXING_NOT_READY",
        message: "The sitemap plan is incomplete; review it again.",
        retryable: false,
      };
      return false;
    }
    const generation = ++this.sitemapGeneration;
    this.sitemapState = "applying";
    this.sitemapError = null;
    const request: SitemapSubmitArgs = {
      provider: "bing",
      ...(url ? { url } : {}),
      allowWrite: true,
      confirm: token,
    };
    const result = await this.submitSitemap(request, configPath);
    if (generation !== this.sitemapGeneration) {
      return false;
    }
    if (!result.ok && result.error.code === "RUN_CANCELLED") {
      this.sitemapPlan = null;
      this.sitemapWarnings = result.warnings;
      this.sitemapState = "cancelled";
      return false;
    }
    if (result.ok) {
      this.sitemapOutcome = normalizeIndexingOutcome(
        withEnvelopeMeta(result.data, result.meta),
        this.sitemapPlan,
      );
      this.sitemapWarnings = result.warnings;
      this.sitemapState = "applied";
      return true;
    }
    // A token may have been consumed or expired; never replay it.
    this.sitemapPlan = null;
    this.sitemapError = engineError(result.error);
    this.sitemapWarnings = result.warnings;
    this.sitemapState = "error";
    return false;
  }

  /** Plan phase for `indexnow submit --from-sitemap`. */
  async planIndexNow(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      this.invalidateIndexNow();
      this.indexNowError = {
        code: "CONFIG_PATH_REQUIRED",
        message: "Open a workspace before reviewing an IndexNow submit.",
        retryable: false,
      };
      this.indexNowState = "error";
      return false;
    }
    const sitemapUrl = this.sitemapRequestUrl;
    if (sitemapUrl !== null && !isHttpUrl(sitemapUrl)) {
      this.indexNowError = {
        code: "INVALID_SITEMAP_URL",
        message: "Sitemap URL must be an absolute http(s) URL.",
        retryable: false,
      };
      this.indexNowState = "error";
      return false;
    }
    const generation = ++this.indexNowGeneration;
    this.indexNowState = "planning";
    this.indexNowPlan = null;
    this.indexNowOutcome = null;
    this.indexNowPending = false;
    this.indexNowError = null;
    const request: IndexNowSubmitArgs = {
      ...(sitemapUrl ? { sitemapUrl } : {}),
      // Same engine rule as the sitemap plan: opt in, no token yet.
      allowWrite: true,
    };
    const result = await this.submitIndexNow(request, configPath);
    if (generation !== this.indexNowGeneration) {
      return false;
    }
    if (!result.ok && result.error.code === "RUN_CANCELLED") {
      this.indexNowWarnings = result.warnings;
      this.indexNowState = "cancelled";
      return false;
    }
    if (result.ok) {
      this.indexNowPlan = normalizeIndexingPlan(
        withEnvelopeMeta(result.data, result.meta),
      );
      this.indexNowWarnings = result.warnings;
      this.indexNowState = "planned";
      return true;
    }
    this.indexNowError = engineError(result.error);
    this.indexNowWarnings = result.warnings;
    this.indexNowState = "error";
    return false;
  }

  requestIndexNowApply(): boolean {
    if (!this.indexNowPlan?.confirmToken) {
      this.indexNowError = {
        code: "INDEXING_TOKEN_MISSING",
        message:
          "The plan has no confirmation token, so it cannot be submitted.",
        retryable: false,
      };
      return false;
    }
    if (!this.indexNowReady) {
      this.indexNowError = {
        code: "INDEXING_NOT_READY",
        message: "Review the IndexNow plan before submitting it.",
        retryable: false,
      };
      return false;
    }
    this.indexNowPending = true;
    return true;
  }

  cancelIndexNowApply(): void {
    this.indexNowPending = false;
  }

  async confirmIndexNow(configPath: string | null): Promise<boolean> {
    if (!this.indexNowPending) {
      this.indexNowError = {
        code: "INDEXING_NOT_CONFIRMED",
        message: "Confirm the IndexNow submit in the dialog before applying it.",
        retryable: false,
      };
      return false;
    }
    this.indexNowPending = false;
    const token = this.indexNowPlan?.confirmToken ?? null;
    const sitemapUrl = this.sitemapRequestUrl;
    if (
      !token ||
      !configPath ||
      (sitemapUrl !== null && !isHttpUrl(sitemapUrl))
    ) {
      this.indexNowError = {
        code: "INDEXING_NOT_READY",
        message: "The IndexNow plan is incomplete; review it again.",
        retryable: false,
      };
      return false;
    }
    const generation = ++this.indexNowGeneration;
    this.indexNowState = "applying";
    this.indexNowError = null;
    const request: IndexNowSubmitArgs = {
      ...(sitemapUrl ? { sitemapUrl } : {}),
      allowWrite: true,
      confirm: token,
    };
    const result = await this.submitIndexNow(request, configPath);
    if (generation !== this.indexNowGeneration) {
      return false;
    }
    if (!result.ok && result.error.code === "RUN_CANCELLED") {
      this.indexNowPlan = null;
      this.indexNowWarnings = result.warnings;
      this.indexNowState = "cancelled";
      return false;
    }
    if (result.ok) {
      this.indexNowOutcome = normalizeIndexingOutcome(
        withEnvelopeMeta(result.data, result.meta),
        this.indexNowPlan,
      );
      this.indexNowWarnings = result.warnings;
      this.indexNowState = "applied";
      return true;
    }
    this.indexNowPlan = null;
    this.indexNowError = engineError(result.error);
    this.indexNowWarnings = result.warnings;
    this.indexNowState = "error";
    return false;
  }

  /**
   * Plan native Bing URL submission. A plan carries the write opt-in but no
   * token; it mints the reviewed token and reports the URL/batch/quota view.
   */
  async planBing(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      this.invalidateBing();
      this.bingError = {
        code: "CONFIG_PATH_REQUIRED",
        message: "Open a workspace before reviewing a Bing URL submission.",
        retryable: false,
      };
      this.bingState = "error";
      return false;
    }
    if (!this.bingSourceReady) {
      this.bingError = {
        code: "BING_SUBMIT_SOURCE_REQUIRED",
        message:
          "Enter at least one absolute http(s) URL or read the list from the sitemap.",
        retryable: false,
      };
      this.bingState = "error";
      return false;
    }
    if (this.bingInvalidUrls.length) {
      this.bingError = {
        code: "INVALID_SUBMIT_URL",
        message: "Every submitted URL must be an absolute http(s) URL.",
        retryable: false,
      };
      this.bingState = "error";
      return false;
    }
    const sitemapUrl = this.sitemapRequestUrl;
    if (this.bingFromSitemap && sitemapUrl !== null && !isHttpUrl(sitemapUrl)) {
      this.bingError = {
        code: "INVALID_SITEMAP_URL",
        message: "Sitemap URL must be an absolute http(s) URL.",
        retryable: false,
      };
      this.bingState = "error";
      return false;
    }
    const generation = ++this.bingGeneration;
    this.bingState = "planning";
    this.bingPlan = null;
    this.bingPlanCounts = null;
    this.bingOutcome = null;
    this.bingOutcomeCounts = null;
    this.bingPending = false;
    this.bingError = null;
    const urls = this.bingUrls;
    const request: BingSubmitArgs = {
      provider: "bing",
      ...(urls.length ? { urls } : {}),
      ...(this.bingFromSitemap
        ? { fromSitemap: true, ...(sitemapUrl ? { sitemapUrl } : {}) }
        : {}),
      // The engine's write gate requires the opt-in even for a plan; no token
      // is sent, so this only mints a reviewed plan.
      allowWrite: true,
    };
    const result = await this.submitBing(request, configPath);
    if (generation !== this.bingGeneration) {
      return false;
    }
    if (!result.ok && result.error.code === "RUN_CANCELLED") {
      this.bingWarnings = result.warnings;
      this.bingState = "cancelled";
      return false;
    }
    if (result.ok) {
      const data = withEnvelopeMeta(result.data, result.meta);
      this.bingPlan = normalizeIndexingPlan(data);
      this.bingPlanCounts = normalizeBingSubmitCounts(data, "plan");
      this.bingWarnings = result.warnings;
      this.bingState = "planned";
      return true;
    }
    this.bingError = engineError(result.error);
    this.bingWarnings = result.warnings;
    this.bingState = "error";
    return false;
  }

  /** Open the confirmation dialog; never calls the engine. */
  requestBingApply(): boolean {
    if (!this.bingPlan?.confirmToken) {
      this.bingError = {
        code: "INDEXING_TOKEN_MISSING",
        message:
          "The plan has no confirmation token, so it cannot be submitted.",
        retryable: false,
      };
      return false;
    }
    if (!this.bingReady) {
      this.bingError = {
        code: "INDEXING_NOT_READY",
        message: "Review the Bing URL submission plan before applying it.",
        retryable: false,
      };
      return false;
    }
    this.bingPending = true;
    return true;
  }

  cancelBingApply(): void {
    this.bingPending = false;
  }

  /**
   * Apply phase. The explicit `requestBingApply` is the confirmation gate: a
   * direct call without it is refused before the engine sees the token.
   */
  async confirmBing(configPath: string | null): Promise<boolean> {
    if (!this.bingPending) {
      this.bingError = {
        code: "INDEXING_NOT_CONFIRMED",
        message:
          "Confirm the Bing URL submission in the dialog before applying it.",
        retryable: false,
      };
      return false;
    }
    this.bingPending = false;
    const token = this.bingPlan?.confirmToken ?? null;
    const sitemapUrl = this.sitemapRequestUrl;
    const urls = this.bingUrls;
    if (
      !token ||
      !configPath ||
      !this.bingSourceReady ||
      this.bingInvalidUrls.length > 0 ||
      (this.bingFromSitemap && sitemapUrl !== null && !isHttpUrl(sitemapUrl))
    ) {
      this.bingError = {
        code: "INDEXING_NOT_READY",
        message: "The Bing URL submission plan is incomplete; review it again.",
        retryable: false,
      };
      return false;
    }
    const generation = ++this.bingGeneration;
    this.bingState = "applying";
    this.bingError = null;
    const request: BingSubmitArgs = {
      provider: "bing",
      ...(urls.length ? { urls } : {}),
      ...(this.bingFromSitemap
        ? { fromSitemap: true, ...(sitemapUrl ? { sitemapUrl } : {}) }
        : {}),
      allowWrite: true,
      confirm: token,
    };
    const result = await this.submitBing(request, configPath);
    if (generation !== this.bingGeneration) {
      return false;
    }
    if (!result.ok && result.error.code === "RUN_CANCELLED") {
      this.bingPlan = null;
      this.bingWarnings = result.warnings;
      this.bingState = "cancelled";
      return false;
    }
    if (result.ok) {
      const data = withEnvelopeMeta(result.data, result.meta);
      this.bingOutcome = normalizeIndexingOutcome(data, this.bingPlan);
      this.bingOutcomeCounts = normalizeBingSubmitCounts(data, "result");
      this.bingWarnings = result.warnings;
      this.bingState = "applied";
      return true;
    }
    // A token may have been consumed or expired; never replay it.
    this.bingPlan = null;
    this.bingPlanCounts = null;
    this.bingError = engineError(result.error);
    this.bingWarnings = result.warnings;
    this.bingState = "error";
    return false;
  }

  /** Read-only `bing sitemaps` (`GetFeeds`) load. */
  async loadBingSitemaps(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      this.sitemapsReport = null;
      this.sitemapsWarnings = [];
      this.sitemapsError = {
        code: "CONFIG_PATH_REQUIRED",
        message: "Open a workspace before reading Bing sitemaps.",
        retryable: false,
      };
      this.sitemapsState = "error";
      return false;
    }
    const generation = ++this.sitemapsGeneration;
    this.sitemapsState = "loading";
    this.sitemapsError = null;
    const result = await this.loadSitemaps(configPath);
    if (generation !== this.sitemapsGeneration) {
      return false;
    }
    if (result.ok) {
      this.sitemapsReport = normalizeBingSitemaps(
        withEnvelopeMeta(result.data, result.meta),
      );
      this.sitemapsWarnings = result.warnings;
      this.sitemapsState = "loaded";
      return true;
    }
    this.sitemapsError = engineError(result.error);
    this.sitemapsWarnings = result.warnings;
    this.sitemapsState = "error";
    return false;
  }

  /** Read-only `bing issues` (`GetCrawlIssues`) load. */
  async loadBingIssues(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      this.issuesReport = null;
      this.issuesWarnings = [];
      this.issuesError = {
        code: "CONFIG_PATH_REQUIRED",
        message: "Open a workspace before reading Bing crawl issues.",
        retryable: false,
      };
      this.issuesState = "error";
      return false;
    }
    const generation = ++this.issuesGeneration;
    this.issuesState = "loading";
    this.issuesError = null;
    const result = await this.loadIssues(configPath);
    if (generation !== this.issuesGeneration) {
      return false;
    }
    if (result.ok) {
      this.issuesReport = normalizeBingIssues(
        withEnvelopeMeta(result.data, result.meta),
      );
      this.issuesWarnings = result.warnings;
      this.issuesState = "loaded";
      return true;
    }
    this.issuesError = engineError(result.error);
    this.issuesWarnings = result.warnings;
    this.issuesState = "error";
    return false;
  }

  /** Read-only `bing quota` (`GetUrlSubmissionQuota`) load. */
  async loadBingQuota(configPath: string | null): Promise<boolean> {
    if (!configPath) {
      this.quotaReport = null;
      this.quotaWarnings = [];
      this.quotaError = {
        code: "CONFIG_PATH_REQUIRED",
        message: "Open a workspace before reading the Bing quota.",
        retryable: false,
      };
      this.quotaState = "error";
      return false;
    }
    const generation = ++this.quotaGeneration;
    this.quotaState = "loading";
    this.quotaError = null;
    const result = await this.loadQuota(configPath);
    if (generation !== this.quotaGeneration) {
      return false;
    }
    if (result.ok) {
      this.quotaReport = normalizeBingQuota(
        withEnvelopeMeta(result.data, result.meta),
      );
      this.quotaWarnings = result.warnings;
      this.quotaState = "loaded";
      return true;
    }
    this.quotaError = engineError(result.error);
    this.quotaWarnings = result.warnings;
    this.quotaState = "error";
    return false;
  }

  /**
   * Open the official Bing Site Scan page. The shell validates the https site
   * URL and hard-codes the destination; the desktop never starts a scan.
   */
  async openSiteScan(): Promise<boolean> {
    const site = this.siteUrl.trim();
    if (!isHttpsUrl(site)) {
      this.siteScanError = {
        code: "INVALID_SITE_URL",
        message: "Site URL must be an absolute https URL.",
        retryable: false,
      };
      this.siteScanState = "error";
      return false;
    }
    const generation = ++this.siteScanGeneration;
    this.siteScanState = "opening";
    this.siteScanError = null;
    this.siteScanOpenedUrl = null;
    try {
      const opened = await this.openScan(site);
      if (generation !== this.siteScanGeneration) {
        return false;
      }
      this.siteScanOpenedUrl = opened;
      this.siteScanState = "opened";
      return true;
    } catch (error) {
      if (generation !== this.siteScanGeneration) {
        return false;
      }
      this.siteScanError = toAppError(error, "OPEN_URL");
      this.siteScanState = "error";
      return false;
    }
  }

  /** Drop all plans/lists and in-flight requests (workspace switch or unmount). */
  reset(): void {
    this.invalidateSitemap();
    this.invalidateIndexNow();
    this.invalidateBing();
    this.invalidateBingLists();
    this.invalidateSiteScan();
    this.sitemapUrl = "";
    this.bingUrlInput = "";
    this.bingFromSitemap = false;
    this.siteUrl = "";
  }

  private invalidateSitemap(): void {
    this.sitemapGeneration += 1;
    this.sitemapState = "idle";
    this.sitemapPlan = null;
    this.sitemapOutcome = null;
    this.sitemapWarnings = [];
    this.sitemapError = null;
    this.sitemapPending = false;
  }

  private invalidateIndexNow(): void {
    this.indexNowGeneration += 1;
    this.indexNowState = "idle";
    this.indexNowPlan = null;
    this.indexNowOutcome = null;
    this.indexNowWarnings = [];
    this.indexNowError = null;
    this.indexNowPending = false;
  }

  private invalidateBing(): void {
    this.bingGeneration += 1;
    this.bingState = "idle";
    this.bingPlan = null;
    this.bingOutcome = null;
    this.bingPlanCounts = null;
    this.bingOutcomeCounts = null;
    this.bingWarnings = [];
    this.bingError = null;
    this.bingPending = false;
  }

  private invalidateBingLists(): void {
    this.sitemapsGeneration += 1;
    this.sitemapsState = "idle";
    this.sitemapsReport = null;
    this.sitemapsWarnings = [];
    this.sitemapsError = null;
    this.issuesGeneration += 1;
    this.issuesState = "idle";
    this.issuesReport = null;
    this.issuesWarnings = [];
    this.issuesError = null;
    this.quotaGeneration += 1;
    this.quotaState = "idle";
    this.quotaReport = null;
    this.quotaWarnings = [];
    this.quotaError = null;
  }

  private invalidateSiteScan(): void {
    this.siteScanGeneration += 1;
    this.siteScanState = "idle";
    this.siteScanError = null;
    this.siteScanOpenedUrl = null;
  }
}
