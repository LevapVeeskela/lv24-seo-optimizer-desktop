import { invoke } from "@tauri-apps/api/core";
import { cliRun, type Envelope } from "@/shared/cli";

/**
 * `sitemap_submit` is two-phase. The engine's write gate requires
 * `allow_write=true` even for the dry run, so the plan carries `allowWrite`
 * without `confirm` and only mints a token. The apply carries `allowWrite` and
 * the token from the reviewed plan. `--url` is optional: the engine defaults to
 * `{project.base_url}/sitemap.xml`.
 */
export interface SitemapSubmitArgs {
  provider: "bing";
  url?: string;
  allowWrite?: boolean;
  confirm?: string;
}

export function runSitemapSubmit(
  args: SitemapSubmitArgs,
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("sitemap_submit", {
    args,
    ...(configPath ? { configPath } : {}),
  });
}

/**
 * `indexnow_submit --from-sitemap` reads the sitemap in the engine. The
 * optional `sitemapUrl` defaults to `{project.base_url}/sitemap.xml`. The plan
 * sends `allowWrite` without `confirm`; the apply adds the reviewed token.
 */
export interface IndexNowSubmitArgs {
  sitemapUrl?: string;
  allowWrite?: boolean;
  confirm?: string;
}

export function runIndexNowSubmit(
  args: IndexNowSubmitArgs,
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("indexnow_submit", {
    args,
    ...(configPath ? { configPath } : {}),
  });
}

/**
 * `bing submit` is the native Bing URL submission command. The plan sends
 * `allowWrite` without `confirm`; the apply adds the reviewed token. A call
 * submits either explicit URLs, the shared sitemap, or both. The engine splits
 * the list into provider batches and reports how many URLs were accepted.
 */
export interface BingSubmitArgs {
  provider?: "bing";
  urls?: string[];
  fromSitemap?: boolean;
  sitemapUrl?: string;
  allowWrite?: boolean;
  confirm?: string;
}

export function runBingSubmit(
  args: BingSubmitArgs,
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("bing_submit", {
    args,
    ...(configPath ? { configPath } : {}),
  });
}

/** Read-only Bing feed/status list; no write flag is accepted by the shell. */
export function runBingSitemaps(
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("bing_sitemaps", {
    ...(configPath ? { configPath } : {}),
  });
}

/** Read-only Bing crawl-issue list. */
export function runBingIssues(
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("bing_issues", {
    ...(configPath ? { configPath } : {}),
  });
}

/** Read-only Bing URL submission quota (remaining daily/monthly). */
export function runBingQuota(configPath?: string): Promise<Envelope<unknown>> {
  return cliRun<unknown>("bing_quota", {
    ...(configPath ? { configPath } : {}),
  });
}

/**
 * The shell hard-codes the destination `https://www.bing.com/webmasters/sitescan`
 * and only places an absolute https site URL in the `siteUrl` query. It returns
 * the URL that was opened; it never starts a scan.
 */
export function openBingSiteScan(siteUrl: string): Promise<string> {
  return invoke<string>("open_bing_sitescan", { siteUrl });
}
