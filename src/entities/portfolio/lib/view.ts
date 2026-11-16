import type { PortfolioSite } from "../model/types";

export const PORTFOLIO_SORTS = [
  "issues",
  "name",
  "lastActivity",
  "errors",
] as const;

export type PortfolioSort = (typeof PORTFOLIO_SORTS)[number];

export const PORTFOLIO_SORT_DEFAULT: PortfolioSort = "issues";

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function activityTime(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** Case-insensitive match over the name, property and config path. */
export function filterPortfolioSites(
  sites: readonly PortfolioSite[],
  query: string,
): PortfolioSite[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...sites];
  }
  return sites.filter((site) =>
    [site.name, site.property ?? "", site.configPath].some((value) =>
      value.toLowerCase().includes(needle),
    ),
  );
}

/**
 * Stable, deterministic ordering. Unknown activity sorts last; unknown issue
 * counts sort last; errored sites lead the error view so a broken project is
 * never buried under healthy ones.
 */
export function sortPortfolioSites(
  sites: readonly PortfolioSite[],
  sort: PortfolioSort,
): PortfolioSite[] {
  const rows = [...sites];
  switch (sort) {
    case "name":
      return rows.sort((a, b) => compareText(a.name, b.name));
    case "lastActivity":
      return rows.sort((a, b) => {
        const left = activityTime(a.lastActivity);
        const right = activityTime(b.lastActivity);
        if (left === null && right === null) {
          return compareText(a.name, b.name);
        }
        if (left === null) {
          return 1;
        }
        if (right === null) {
          return -1;
        }
        return right - left || compareText(a.name, b.name);
      });
    case "errors":
      return rows.sort(
        (a, b) =>
          Number(b.error !== null) - Number(a.error !== null) ||
          compareText(a.name, b.name),
      );
    case "issues":
    default:
      return rows.sort(
        (a, b) =>
          (b.issues.total ?? -1) - (a.issues.total ?? -1) ||
          compareText(a.name, b.name),
      );
  }
}

export function isPortfolioSort(value: unknown): value is PortfolioSort {
  return (
    typeof value === "string" &&
    (PORTFOLIO_SORTS as readonly string[]).includes(value)
  );
}
