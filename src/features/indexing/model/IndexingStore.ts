import { makeAutoObservable } from "mobx";
import type { Envelope } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";
import {
  openBingSiteScan,
  runIndexNowSubmit,
  runSitemapSubmit,
  type IndexNowSubmitArgs,
  type SitemapSubmitArgs,
} from "../lib/ipc";
import {
  indexingErrorHint,
  normalizeIndexingOutcome,
  normalizeIndexingPlan,
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

export type SitemapSubmitFn = (
  args: SitemapSubmitArgs,
  configPath?: string,
) => Promise<Envelope<unknown>>;

export type IndexNowSubmitFn = (
  args: IndexNowSubmitArgs,
  configPath?: string,
) => Promise<Envelope<unknown>>;

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

  siteUrl = "";
  siteScanState: SiteScanState = "idle";
  siteScanError: AppError | null = null;
  siteScanOpenedUrl: string | null = null;

  private sitemapGeneration = 0;
  private indexNowGeneration = 0;
  private siteScanGeneration = 0;
  private readonly submitSitemap: SitemapSubmitFn;
  private readonly submitIndexNow: IndexNowSubmitFn;
  private readonly openScan: OpenSiteScanFn;

  constructor(
    submitSitemap: SitemapSubmitFn = runSitemapSubmit,
    submitIndexNow: IndexNowSubmitFn = runIndexNowSubmit,
    openScan: OpenSiteScanFn = openBingSiteScan,
  ) {
    this.submitSitemap = submitSitemap;
    this.submitIndexNow = submitIndexNow;
    this.openScan = openScan;
    makeAutoObservable<
      IndexingStore,
      | "sitemapGeneration"
      | "indexNowGeneration"
      | "siteScanGeneration"
      | "submitSitemap"
      | "submitIndexNow"
      | "openScan"
    >(
      this,
      {
        sitemapGeneration: false,
        indexNowGeneration: false,
        siteScanGeneration: false,
        submitSitemap: false,
        submitIndexNow: false,
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

  /** Changing the shared sitemap invalidates both plans built from it. */
  setSitemapUrl(value: string): void {
    if (value === this.sitemapUrl) {
      return;
    }
    this.sitemapUrl = value;
    this.invalidateSitemap();
    this.invalidateIndexNow();
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
      this.sitemapPlan = normalizeIndexingPlan(result.data);
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
        result.data,
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
      this.indexNowPlan = normalizeIndexingPlan(result.data);
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
        result.data,
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

  /** Drop both plans and in-flight requests (workspace switch or unmount). */
  reset(): void {
    this.invalidateSitemap();
    this.invalidateIndexNow();
    this.invalidateSiteScan();
    this.sitemapUrl = "";
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

  private invalidateSiteScan(): void {
    this.siteScanGeneration += 1;
    this.siteScanState = "idle";
    this.siteScanError = null;
    this.siteScanOpenedUrl = null;
  }
}
