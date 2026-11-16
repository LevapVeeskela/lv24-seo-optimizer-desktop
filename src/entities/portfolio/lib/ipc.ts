import { cliRun, type Envelope } from "@/shared/cli";

export interface PortfolioListArgs {
  /** Absolute folder that contains one or more project directories. */
  root: string;
  /** 1..50 sites; the engine clamps and reports `truncated` in `meta`. */
  limit?: number;
}

/** Read-only multi-site roll-up; `portfolio_list` is in the shell allow-list. */
export function listPortfolio(
  args: PortfolioListArgs,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("portfolio_list", { args });
}
