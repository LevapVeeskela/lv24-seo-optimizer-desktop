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
 * The shell hard-codes the destination `https://www.bing.com/webmasters/sitescan`
 * and only places an absolute https site URL in the `siteUrl` query. It returns
 * the URL that was opened; it never starts a scan.
 */
export function openBingSiteScan(siteUrl: string): Promise<string> {
  return invoke<string>("open_bing_sitescan", { siteUrl });
}
