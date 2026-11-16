import type { AppError } from "@/shared/lib/errors";
import type { PortfolioSite } from "../model/types";

/** The slice of `WorkspaceStore` the action needs; injected for tests. */
export interface WorkspaceActivator {
  activate(path: string): Promise<{ ok: boolean; error: AppError | null }>;
}

export type OpenPortfolioResult =
  | { ok: true; configPath: string }
  | { ok: false; error: AppError };

/**
 * Open a portfolio row through the existing workspace flow (`settings_set` +
 * `shell_status` reload + stats refresh), never by writing a config path
 * directly. The shell still validates the path; this helper only guards the
 * one case the UI can detect before calling it — a row without a config path.
 */
export async function openPortfolioSite(
  workspace: WorkspaceActivator,
  site: PortfolioSite,
): Promise<OpenPortfolioResult> {
  const configPath = site.configPath.trim();
  if (!configPath) {
    return {
      ok: false,
      error: {
        code: "PORTFOLIO_CONFIG_MISSING",
        message: "This site has no seo.toml path to open.",
        retryable: false,
      },
    };
  }
  const result = await workspace.activate(configPath);
  if (result.ok) {
    return { ok: true, configPath };
  }
  return {
    ok: false,
    error: result.error ?? {
      code: "WORKSPACE_NOT_ACTIVATED",
      message: "The shell did not switch to this workspace.",
      retryable: false,
    },
  };
}
