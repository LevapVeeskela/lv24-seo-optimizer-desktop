import { isRecord, numberValue, stringValue } from "@/shared/lib/format";
import { workspaceLabel } from "@/entities/workspace";

export const PORTFOLIO_ROOT_KEY = "lv24.portfolioRoot";
/** The shell caps one roll-up at 50 sites; the engine reports `truncated`. */
export const PORTFOLIO_LIMIT_DEFAULT = 50;
export const PORTFOLIO_LIMIT_MAX = 50;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const sessionRoots = new Map<string, string>();

/**
 * The shell approves a picked folder for the current process only. Keeping the
 * root in session memory (not `localStorage`) means a restart asks for the
 * folder again instead of auto-loading a path the shell will reject.
 */
export function sessionStorage(): StorageLike {
  return {
    getItem: (key) => sessionRoots.get(key) ?? null,
    setItem: (key, value) => {
      sessionRoots.set(key, value);
    },
  };
}

/** Issue counters from the engine's local database scan. */
export interface PortfolioIssues {
  /** Open issues (`issues_open`), the number the portfolio list is about. */
  total: number | null;
  /** Open critical issues (`issues_critical`). */
  critical: number | null;
  /** Every stored issue, open and closed (`issues_total`). */
  all: number | null;
}

/**
 * One site in the portfolio roll-up. The row always keeps its config path, so
 * a site with a read error stays visible and can still be opened or retried
 * instead of disappearing from the list.
 */
export interface PortfolioSite {
  /** Absolute `seo.toml` path reported by the engine. */
  configPath: string;
  /** Human label: the engine name, the folder name, or the property. */
  name: string;
  /** GSC property (`https://…` or `sc-domain:…`) when reported. */
  property: string | null;
  /** ISO-8601 timestamp of the newest stored activity. */
  lastActivity: string | null;
  issues: PortfolioIssues;
  /** Per-site failure text; the row renders the error instead of clean counts. */
  error: string | null;
}

export interface PortfolioMapping {
  sites: PortfolioSite[];
  /** Rows the engine returned but the UI could not trust. */
  skipped: number;
}

export interface PortfolioMeta {
  total: number;
  truncated: boolean;
  dataAgeDays: number | null;
  limitations: string[];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      )
    : [];
}

function issueCount(value: unknown): number | null {
  const count = numberValue(value);
  return count === null ? null : Math.max(0, Math.trunc(count));
}

/**
 * The engine reports flat `issues_open` / `issues_total` / `issues_critical`
 * counters. A nested `issues` object is accepted for a future payload; an
 * absent counter stays `null` instead of becoming a fake zero.
 */
function mapIssues(raw: Record<string, unknown>): PortfolioIssues {
  const nested = isRecord(raw.issues) ? raw.issues : {};
  return {
    total:
      issueCount(raw.issues_open) ??
      issueCount(nested.open) ??
      issueCount(nested.total) ??
      null,
    critical:
      issueCount(raw.issues_critical) ??
      issueCount(nested.critical) ??
      null,
    all:
      issueCount(raw.issues_total) ??
      issueCount(nested.all) ??
      null,
  };
}

function mapError(value: unknown): string | null {
  const text = stringValue(value)?.trim();
  if (text) {
    return text;
  }
  if (!isRecord(value)) {
    return null;
  }
  const message = stringValue(value.message)?.trim();
  const code = stringValue(value.code)?.trim();
  return message ?? code ?? null;
}

/**
 * Map one `portfolio_list` site. A row without a config path cannot be opened
 * and is reported as skipped; everything else degrades to `null`, never to a
 * fake zero.
 */
export function mapPortfolioSite(raw: unknown): PortfolioSite | null {
  if (!isRecord(raw)) {
    return null;
  }
  const configPath =
    stringValue(raw.config_path)?.trim() ??
    stringValue(raw.configPath)?.trim() ??
    stringValue(raw.path)?.trim() ??
    "";
  if (!configPath) {
    return null;
  }
  const property =
    stringValue(raw.property)?.trim() ??
    stringValue(raw.property_id)?.trim() ??
    null;
  const derivedName = workspaceLabel(configPath) || property || configPath;
  const name =
    stringValue(raw.name)?.trim() ??
    stringValue(raw.label)?.trim() ??
    derivedName;
  const lastActivity =
    stringValue(raw.last_activity)?.trim() ??
    stringValue(raw.last_activity_at)?.trim() ??
    stringValue(raw.last_run)?.trim() ??
    stringValue(raw.latest_snapshot_at)?.trim() ??
    null;
  return {
    configPath,
    name,
    property,
    lastActivity,
    issues: mapIssues(raw),
    error: mapError(raw.error),
  };
}

/**
 * `portfolio_list` returns `{sites: [...]}`; a bare array is accepted as well
 * so a transport change does not blank the page. `null` means the envelope had
 * no site array at all (a contract failure the store reports as an error).
 */
export function mapPortfolioList(data: unknown): PortfolioMapping | null {
  const rows = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.sites)
      ? data.sites
      : null;
  if (!rows) {
    return null;
  }
  const sites: PortfolioSite[] = [];
  let skipped = 0;
  for (const item of rows) {
    const site = mapPortfolioSite(item);
    if (site) {
      sites.push(site);
    } else {
      skipped += 1;
    }
  }
  return { sites, skipped };
}

export function mapPortfolioMeta(
  meta: unknown,
  siteCount: number,
  skipped: number,
): PortfolioMeta {
  const record = isRecord(meta) ? meta : {};
  const total = numberValue(record.total) ?? siteCount + skipped;
  return {
    total,
    truncated:
      record.truncated === true || total > siteCount + skipped,
    dataAgeDays: numberValue(record.data_age_days),
    limitations: stringList(record.limitations),
  };
}

/** Root is a folder path; a stray trailing separator is harmless but noisy. */
export function normalizePortfolioRoot(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  const withoutTrailing = trimmed.replace(/[\\/]+$/, "");
  // Keep a bare POSIX root ("/") and a Windows drive root ("C:\").
  if (!withoutTrailing) {
    return trimmed.slice(0, 1);
  }
  if (/^[a-z]:$/i.test(withoutTrailing)) {
    return `${withoutTrailing}\\`;
  }
  return withoutTrailing;
}

export function readStoredRoot(storage: StorageLike | null): string | null {
  try {
    return normalizePortfolioRoot(storage?.getItem(PORTFOLIO_ROOT_KEY));
  } catch {
    return null;
  }
}

export function writeStoredRoot(
  storage: StorageLike | null,
  root: string,
): void {
  try {
    storage?.setItem(PORTFOLIO_ROOT_KEY, root);
  } catch {
    // The chosen root still applies for this session when storage is unavailable.
  }
}
