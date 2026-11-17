import { isRecord, numberValue, stringValue } from "@/shared/lib/format";

/**
 * Read-only shapes for `indexing status`, `indexing history` and
 * `schedule status --kind indexing` (engine >= 0.13.1).
 *
 * Every field is optional in the wire payload, so a normalizer never throws:
 * an unexpected answer renders as an explicit empty state instead of zeros.
 */

export const INDEXING_PROVIDERS = [
  "bing",
  "yandex",
  "gsc",
  "indexnow",
] as const;
export type IndexingProvider = (typeof INDEXING_PROVIDERS)[number];

/**
 * Engine limitations that mean the provider has no queue at all (no site,
 * property, key or credential). The card shows "no data yet" instead of the
 * engine's structural zeros for such a row.
 */
const NOT_READY_LIMITATIONS = [
  "provider_not_configured",
  "provider_auth_required",
  "indexnow_key_missing",
];

export function providerNotReady(entry: IndexingProviderStatus): boolean {
  return entry.limitations.some((item) =>
    NOT_READY_LIMITATIONS.includes(item),
  );
}

export interface IndexingQuota {
  source: string | null;
  remaining: number | null;
  dailyRemaining: number | null;
  monthlyRemaining: number | null;
  used: number | null;
  limit: number | null;
  reset: string | null;
}

export interface IndexingProviderStatus {
  provider: IndexingProvider;
  propertyId: string | null;
  urls: number | null;
  submitted: number | null;
  inspected: number | null;
  indexed: number | null;
  notIndexed: number | null;
  crawled: number | null;
  unknown: number | null;
  queued: number | null;
  stale: number | null;
  pending: number | null;
  indexedTotal: number | null;
  indexedTotalSource: string | null;
  quota: IndexingQuota | null;
  limitations: string[];
  dataAgeDays: number | null;
}

export interface IndexingStatusReport {
  providers: Partial<Record<IndexingProvider, IndexingProviderStatus>>;
  limitations: string[];
  writeSecretPresent: boolean | null;
  dataAgeDays: number | null;
  total: number | null;
  truncated: boolean | null;
  live: boolean | null;
}

export interface IndexingRunError {
  url: string | null;
  code: string | null;
  message: string | null;
}

export interface IndexingRun {
  startedAt: string | null;
  finishedAt: string | null;
  provider: string | null;
  status: string | null;
  planned: number | null;
  submitted: number | null;
  checked: number | null;
  skipped: number | null;
  errors: number | null;
  errorItems: IndexingRunError[];
}

export interface IndexingHistoryReport {
  runs: IndexingRun[];
  total: number | null;
  truncated: boolean | null;
  limitations: string[];
}

export const SCHEDULE_JOB_STATES = [
  "installed",
  "outdated",
  "partial",
  "missing",
  "unknown",
] as const;
export type ScheduleJobState = (typeof SCHEDULE_JOB_STATES)[number];

export interface ScheduleStatusReport {
  state: ScheduleJobState | null;
  name: string | null;
  target: string | null;
  warnings: string[];
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim() !== "",
      )
    : [];
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizeQuota(value: unknown): IndexingQuota | null {
  if (!isRecord(value)) {
    return null;
  }
  const quota: IndexingQuota = {
    source: stringValue(value.source),
    remaining: numberValue(value.remaining),
    dailyRemaining: numberValue(value.daily_remaining),
    monthlyRemaining: numberValue(value.monthly_remaining),
    used: numberValue(value.used),
    limit: numberValue(value.limit),
    reset: stringValue(value.reset),
  };
  const known = Object.entries(quota).some(([key, item]) => {
    if (key === "source" || key === "reset") {
      return false;
    }
    return item !== null;
  });
  return known || quota.source || quota.reset ? quota : null;
}

function normalizeProvider(
  provider: IndexingProvider,
  value: unknown,
): IndexingProviderStatus | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    provider,
    propertyId: stringValue(value.property_id),
    urls: numberValue(value.urls),
    submitted: numberValue(value.submitted),
    inspected: numberValue(value.inspected),
    indexed: numberValue(value.indexed),
    notIndexed: numberValue(value.not_indexed),
    crawled: numberValue(value.crawled),
    unknown: numberValue(value.unknown),
    queued: numberValue(value.queued),
    stale: numberValue(value.stale),
    pending: numberValue(value.pending),
    indexedTotal: numberValue(value.indexed_total),
    indexedTotalSource: stringValue(value.indexed_total_source),
    quota: normalizeQuota(value.quota),
    limitations: stringList(value.limitations),
    dataAgeDays: numberValue(value.data_age_days),
  };
}

/** `data.providers` is keyed by provider; only the four card rows are kept. */
export function normalizeIndexingStatus(
  value: unknown,
  meta: Record<string, unknown> = {},
): IndexingStatusReport {
  const data = record(value);
  const providersRaw = record(data.providers);
  const providers: Partial<Record<IndexingProvider, IndexingProviderStatus>> =
    {};
  for (const provider of INDEXING_PROVIDERS) {
    const entry = normalizeProvider(provider, providersRaw[provider]);
    if (entry) {
      providers[provider] = entry;
    }
  }
  return {
    providers,
    limitations: unique([
      ...stringList(data.limitations),
      ...stringList(meta.limitations),
    ]),
    writeSecretPresent:
      booleanValue(data.write_secret_present) ??
      booleanValue(meta.write_secret_present),
    dataAgeDays:
      numberValue(data.data_age_days) ?? numberValue(meta.data_age_days),
    total: numberValue(meta.total) ?? numberValue(data.total),
    truncated: booleanValue(meta.truncated) ?? booleanValue(data.truncated),
    live: booleanValue(meta.live),
  };
}

function normalizeRunError(value: unknown): IndexingRunError | null {
  if (!isRecord(value)) {
    return null;
  }
  const item: IndexingRunError = {
    url: stringValue(value.url),
    code: stringValue(value.code),
    message: stringValue(value.message),
  };
  return item.url || item.code || item.message ? item : null;
}

function normalizeRun(value: unknown): IndexingRun | null {
  if (!isRecord(value)) {
    return null;
  }
  const detail = record(value.detail);
  const errorItems = Array.isArray(detail.error_items)
    ? detail.error_items
        .map(normalizeRunError)
        .filter((item): item is IndexingRunError => item !== null)
    : [];
  const run: IndexingRun = {
    startedAt: stringValue(value.started_at),
    finishedAt: stringValue(value.finished_at),
    provider: stringValue(value.provider),
    status: stringValue(value.status),
    planned: numberValue(value.planned),
    submitted: numberValue(value.submitted),
    checked: numberValue(value.checked),
    skipped: numberValue(value.skipped),
    errors: numberValue(detail.errors),
    errorItems,
  };
  const present =
    run.startedAt !== null ||
    run.finishedAt !== null ||
    run.provider !== null ||
    run.status !== null ||
    run.submitted !== null;
  return present ? run : null;
}

export function normalizeIndexingHistory(
  value: unknown,
  meta: Record<string, unknown> = {},
): IndexingHistoryReport {
  const data = record(value);
  const rawRuns = Array.isArray(data.runs) ? data.runs : [];
  const runs = rawRuns
    .map(normalizeRun)
    .filter((run): run is IndexingRun => run !== null);
  return {
    runs,
    total: numberValue(meta.total) ?? numberValue(data.total),
    truncated: booleanValue(meta.truncated) ?? booleanValue(data.truncated),
    limitations: unique([
      ...stringList(data.limitations),
      ...stringList(meta.limitations),
    ]),
  };
}

function normalizeScheduleState(value: unknown): ScheduleJobState | null {
  return typeof value === "string" &&
    (SCHEDULE_JOB_STATES as readonly string[]).includes(value)
    ? (value as ScheduleJobState)
    : null;
}

export function normalizeScheduleStatus(
  value: unknown,
  meta: Record<string, unknown> = {},
): ScheduleStatusReport {
  const data = record(value);
  return {
    state: normalizeScheduleState(data.state),
    name: stringValue(data.name) ?? stringValue(meta.kind),
    target: stringValue(data.target) ?? stringValue(meta.target),
    warnings: unique([
      ...stringList(data.warnings),
      ...stringList(meta.warnings),
    ]),
  };
}

/** One day/provider bucket for the compact history table. */export interface IndexingDayBucket {
  day: string;
  provider: string;
  runs: number;
  submitted: number | null;
  checked: number | null;
}

function sum(
  total: number | null,
  value: number | null,
): number | null {
  if (value === null) {
    return total;
  }
  return (total ?? 0) + value;
}

function runDay(run: IndexingRun): string {
  const value = run.startedAt;
  return value && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : "unknown";
}

/** Aggregate the newest runs by day and provider, newest day first. */
export function aggregateRunsByDay(
  runs: IndexingRun[],
): IndexingDayBucket[] {
  const buckets = new Map<string, IndexingDayBucket>();
  for (const run of runs) {
    const day = runDay(run);
    const provider = run.provider ?? "unknown";
    const key = `${day}\u0000${provider}`;
    const bucket = buckets.get(key) ?? {
      day,
      provider,
      runs: 0,
      submitted: null,
      checked: null,
    };
    bucket.runs += 1;
    bucket.submitted = sum(bucket.submitted, run.submitted);
    bucket.checked = sum(bucket.checked, run.checked);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((left, right) => {
    if (left.day !== right.day) {
      if (left.day === "unknown") {
        return 1;
      }
      if (right.day === "unknown") {
        return -1;
      }
      return left.day < right.day ? 1 : -1;
    }
    return left.provider < right.provider
      ? -1
      : left.provider > right.provider
        ? 1
        : 0;
  });
}

function daysBetween(earlier: string, later: string): number | null {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return Math.round((end - start) / 86_400_000);
}

/**
 * Totals for the last `days` calendar days, measured from the newest run in
 * the answer (not the wall clock) so the card is deterministic and honest
 * about a stale history.
 */
export function recentTotals(
  runs: IndexingRun[],
  days: number,
): { runs: number; submitted: number | null; checked: number | null } {
  const dated = runs
    .map((run) => ({ run, day: runDay(run) }))
    .filter((entry) => entry.day !== "unknown");
  const reference = dated
    .map((entry) => entry.day)
    .sort()
    .at(-1);
  if (!reference) {
    return { runs: 0, submitted: null, checked: null };
  }
  let count = 0;
  let submitted: number | null = null;
  let checked: number | null = null;
  for (const entry of dated) {
    const age = daysBetween(entry.day, reference);
    if (age === null || age < 0 || age >= days) {
      continue;
    }
    count += 1;
    submitted = sum(submitted, entry.run.submitted);
    checked = sum(checked, entry.run.checked);
  }
  return { runs: count, submitted, checked };
}

/** The engine predates `indexing status` / `schedule status`. */
export function isUnknownEngineError(code: string | null | undefined): boolean {
  return (
    code === "INVALID_COMMAND" ||
    code === "CLI_INVALID_JSON" ||
    code === "UNKNOWN_COMMAND"
  );
}
