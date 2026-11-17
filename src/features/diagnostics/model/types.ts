import { isRecord, numberValue, stringValue } from "@/shared/lib/format";

/**
 * Read-only platform diagnostics: Google Search Console, Yandex Webmaster,
 * Bing Webmaster, Yandex Metrika and Core Web Vitals. Every normalizer is
 * tolerant of a partial provider answer; a missing field stays `null` and is
 * rendered as "not available" instead of an invented zero.
 */

export interface ReportMeta {
  total: number | null;
  truncated: boolean;
  dataAgeDays: number | null;
  limitations: string[];
  organicOnly: boolean | null;
  sampled: boolean | null;
  sampleShare: number | null;
  sampleSize: number | null;
  sampleSpace: number | null;
  dataLag: number | null;
  totalRowsRounded: boolean | null;
  start: string | null;
  end: string | null;
  group: string | null;
  weeksRequested: number | null;
  weeksReturned: number | null;
  strategy: string | null;
  finalUrl: string | null;
  analysisUtcTimestamp: string | null;
  language: string | null;
}

export type EmptyReason =
  | "no_rows_for_window"
  | "provider_returned_no_rows"
  | "low_traffic"
  | null;

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
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

function boolValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function pick(
  source: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (source[key] !== null && source[key] !== undefined) {
      return source[key];
    }
  }
  return null;
}

function text(
  source: Record<string, unknown>,
  keys: string[],
): string | null {
  return stringValue(pick(source, keys));
}

function number(
  source: Record<string, unknown>,
  keys: string[],
): number | null {
  return numberValue(pick(source, keys));
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * The engine keeps coverage facts in the envelope `meta`, while the payload
 * lives under `data`. Merge them before normalizing so one report object can
 * render both without changing the wire shape.
 */
export function withEnvelopeMeta(
  value: unknown,
  meta: Record<string, unknown>,
): unknown {
  return isRecord(value) ? { ...value, meta } : value;
}

export function normalizeMeta(value: unknown): ReportMeta {
  const data = record(value);
  const meta = record(data.meta);
  const result = record(data.result);
  return {
    total: numberValue(meta.total),
    truncated: meta.truncated === true,
    dataAgeDays: numberValue(meta.data_age_days),
    limitations: unique([
      ...stringList(data.limitations),
      ...stringList(meta.limitations),
      ...stringList(result.limitations),
    ]),
    organicOnly: boolValue(meta.organic_only),
    sampled: boolValue(meta.sampled),
    sampleShare: numberValue(meta.sample_share),
    sampleSize: numberValue(meta.sample_size),
    sampleSpace: numberValue(meta.sample_space),
    dataLag: numberValue(meta.data_lag),
    totalRowsRounded: boolValue(meta.total_rows_rounded),
    start: stringValue(meta.start),
    end: stringValue(meta.end),
    group: stringValue(meta.group),
    weeksRequested: numberValue(meta.weeks_requested),
    weeksReturned: numberValue(meta.weeks_returned),
    strategy: stringValue(meta.strategy),
    finalUrl: stringValue(meta.final_url),
    analysisUtcTimestamp: stringValue(meta.analysis_utc_timestamp),
    language: stringValue(meta.language),
  };
}

/** Provider-empty answers are explicit states, never zeros. */
export function emptyReason(meta: ReportMeta): EmptyReason {
  if (meta.limitations.includes("low_traffic")) {
    return "low_traffic";
  }
  if (meta.limitations.includes("no_rows_for_window")) {
    return "no_rows_for_window";
  }
  if (meta.limitations.includes("provider_returned_no_rows")) {
    return "provider_returned_no_rows";
  }
  return null;
}

// -- Google Search Console -------------------------------------------------

export interface RichResultItem {
  type: string | null;
  issueCount: number;
}

export interface RichResults {
  verdict: string | null;
  items: RichResultItem[];
}

export interface GscInspection {
  url: string | null;
  verdict: string | null;
  coverageState: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  lastCrawlTime: string | null;
  pageFetchState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  canonical: string | null;
  crawledAs: string | null;
  sitemaps: string[];
  referringUrls: string[];
  richResults: RichResults | null;
  inspectionLink: string | null;
  meta: ReportMeta;
}

function normalizeRichResults(value: unknown): RichResults | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    verdict: stringValue(value.verdict),
    items: records(value.detected_items).map((item) => ({
      type: stringValue(item.rich_result_type),
      issueCount: records(item.items).reduce(
        (total, entry) => total + stringList(entry.issues).length,
        0,
      ),
    })),
  };
}

export function normalizeGscInspection(value: unknown): GscInspection {
  const data = record(value);
  const inspection = record(data.inspection);
  return {
    url: stringValue(inspection.url) ?? stringValue(data.url),
    verdict: stringValue(inspection.verdict),
    coverageState: stringValue(inspection.coverage_state),
    robotsTxtState: stringValue(inspection.robots_txt_state),
    indexingState: stringValue(inspection.indexing_state),
    lastCrawlTime: stringValue(inspection.last_crawl_time),
    pageFetchState: stringValue(inspection.page_fetch_state),
    googleCanonical: stringValue(inspection.google_canonical),
    userCanonical: stringValue(inspection.user_canonical),
    canonical: stringValue(inspection.canonical),
    crawledAs: stringValue(inspection.crawled_as),
    sitemaps: stringList(inspection.sitemap),
    referringUrls: stringList(inspection.referring_urls),
    richResults: normalizeRichResults(inspection.rich_results),
    inspectionLink: stringValue(inspection.inspection_result_link),
    meta: normalizeMeta(value),
  };
}

export interface GscSitemapContent {
  type: string | null;
  submitted: number | null;
  indexed: number | null;
  indexedDeprecated: boolean;
}

export interface GscSitemapRow {
  path: string | null;
  type: string | null;
  isSitemapsIndex: boolean | null;
  isPending: boolean | null;
  errors: number | null;
  warnings: number | null;
  lastSubmitted: string | null;
  lastDownloaded: string | null;
  contents: GscSitemapContent[];
}

function normalizeGscSitemap(value: unknown): GscSitemapRow {
  const row = record(value);
  return {
    path: stringValue(row.path),
    type: stringValue(row.type),
    isSitemapsIndex: boolValue(row.is_sitemaps_index),
    isPending: boolValue(row.is_pending),
    errors: numberValue(row.errors),
    warnings: numberValue(row.warnings),
    lastSubmitted: stringValue(row.last_submitted),
    lastDownloaded: stringValue(row.last_downloaded),
    contents: records(row.contents).map((content) => ({
      type: stringValue(content.type),
      submitted: numberValue(content.submitted),
      indexed: numberValue(content.indexed),
      indexedDeprecated: content.indexed_deprecated === true,
    })),
  };
}

export interface GscSitemapsReport {
  rows: GscSitemapRow[];
  sitemapIndex: GscSitemapRow | null;
  meta: ReportMeta;
}

export function normalizeGscSitemaps(value: unknown): GscSitemapsReport {
  const data = record(value);
  return {
    rows: records(data.rows).map(normalizeGscSitemap),
    sitemapIndex: isRecord(data.sitemap_index)
      ? normalizeGscSitemap(data.sitemap_index)
      : null,
    meta: normalizeMeta(value),
  };
}

// -- Yandex Webmaster ------------------------------------------------------

export interface YandexIndexingEvent {
  date: string | null;
  appeared: number | null;
  removed: number | null;
}

export interface YandexIndexingHistoryRow {
  date: string | null;
  http2xx: number | null;
  http3xx: number | null;
  http4xx: number | null;
  http5xx: number | null;
  other: number | null;
}

export interface YandexSummary {
  sqi: number | null;
  pagesInSearch: number | null;
  pagesExcluded: number | null;
  http2xx: number | null;
  siteProblems: number | null;
}

export interface YandexIndexingReport {
  hostId: string | null;
  events: YandexIndexingEvent[];
  history: YandexIndexingHistoryRow[];
  summary: YandexSummary | null;
  meta: ReportMeta;
}

export function normalizeYandexIndexing(value: unknown): YandexIndexingReport {
  const data = record(value);
  const summaryRow = records(data.summary)[0] ?? null;
  const problems = summaryRow ? record(summaryRow.site_problems) : {};
  const problemCount = Object.values(problems).reduce<number>(
    (total, item) => total + (numberValue(item) ?? 0),
    0,
  );
  return {
    hostId: stringValue(data.host_id),
    events: records(data.events).map((row) => ({
      date: stringValue(row.date),
      appeared: numberValue(row.appeared),
      removed: numberValue(row.removed),
    })),
    history: records(data.history).map((row) => ({
      date: stringValue(row.date),
      http2xx: numberValue(row.http_2xx),
      http3xx: numberValue(row.http_3xx),
      http4xx: numberValue(row.http_4xx),
      http5xx: numberValue(row.http_5xx),
      other: numberValue(row.other),
    })),
    summary: summaryRow
      ? {
          sqi: numberValue(summaryRow.sqi),
          pagesInSearch: numberValue(summaryRow.pages_in_search),
          pagesExcluded: numberValue(summaryRow.pages_excluded),
          http2xx: numberValue(summaryRow.http_2xx),
          siteProblems: Object.keys(problems).length ? problemCount : null,
        }
      : null,
    meta: normalizeMeta(value),
  };
}

export interface YandexSitemapRow {
  sitemapId: string | null;
  sitemapUrl: string | null;
  urlsCount: number | null;
  errorsCount: number | null;
  childrenCount: number | null;
  sitemapType: string | null;
  lastAccessDate: string | null;
}

export interface YandexSitemapsReport {
  hostId: string | null;
  rows: YandexSitemapRow[];
  meta: ReportMeta;
}

export function normalizeYandexSitemaps(value: unknown): YandexSitemapsReport {
  const data = record(value);
  return {
    hostId: stringValue(data.host_id),
    rows: records(data.rows).map((row) => ({
      sitemapId: stringValue(row.sitemap_id),
      sitemapUrl: stringValue(row.sitemap_url),
      urlsCount: numberValue(row.urls_count),
      errorsCount: numberValue(row.errors_count),
      childrenCount: numberValue(row.children_count),
      sitemapType: stringValue(row.sitemap_type),
      lastAccessDate: stringValue(row.last_access_date),
    })),
    meta: normalizeMeta(value),
  };
}

export interface YandexQueueRow {
  taskId: string | null;
  url: string | null;
  state: string | null;
  addedTime: string | null;
}

export interface YandexQueueReport {
  hostId: string | null;
  rows: YandexQueueRow[];
  meta: ReportMeta;
}

export function normalizeYandexQueue(value: unknown): YandexQueueReport {
  const data = record(value);
  return {
    hostId: stringValue(data.host_id),
    rows: records(data.rows).map((row) => ({
      taskId: stringValue(row.task_id),
      url: stringValue(row.url),
      state: stringValue(row.state),
      addedTime: stringValue(row.added_time),
    })),
    meta: normalizeMeta(value),
  };
}

// -- Bing Webmaster --------------------------------------------------------

export interface BingStatsReport<T> {
  siteUrl: string | null;
  rows: T[];
  mode: string | null;
  query: string | null;
  page: string | null;
  meta: ReportMeta;
}

export interface BingPageRow {
  page: string | null;
  clicks: number | null;
  impressions: number | null;
  clickPosition: number | null;
  impressionPosition: number | null;
  date: string | null;
}

export interface BingTrafficRow {
  date: string | null;
  clicks: number | null;
  impressions: number | null;
}

export interface BingCrawlRow {
  date: string | null;
  code2xx: number | null;
  code301: number | null;
  code302: number | null;
  code4xx: number | null;
  code5xx: number | null;
  blockedByRobotsTxt: number | null;
  containsMalware: number | null;
  crawlErrors: number | null;
  crawledPages: number | null;
  inIndex: number | null;
  inLinks: number | null;
  allOtherCodes: number | null;
}

export interface BingUrlInfo {
  url: string | null;
  anchorCount: number | null;
  discoveryDate: string | null;
  documentSize: number | null;
  httpStatus: number | null;
  isPage: boolean | null;
  lastCrawledDate: string | null;
  totalChildUrlCount: number | null;
}

export interface BingJoinRow {
  query: string | null;
  page: string | null;
  clicks: number | null;
  impressions: number | null;
  clickPosition: number | null;
  impressionPosition: number | null;
  position: number | null;
  date: string | null;
}

function statsReport<T>(
  value: unknown,
  map: (row: Record<string, unknown>) => T,
): BingStatsReport<T> {
  const data = record(value);
  return {
    siteUrl: stringValue(data.site_url),
    rows: records(data.rows).map(map),
    mode: stringValue(data.mode),
    query: stringValue(data.query),
    page: stringValue(data.page),
    meta: normalizeMeta(value),
  };
}

export function normalizeBingPages(
  value: unknown,
): BingStatsReport<BingPageRow> {
  return statsReport(value, (row) => ({
    page: text(row, ["page", "url"]),
    clicks: number(row, ["clicks"]),
    impressions: number(row, ["impressions"]),
    clickPosition: number(row, ["click_position", "clickPosition"]),
    impressionPosition: number(row, [
      "impression_position",
      "impressionPosition",
    ]),
    date: text(row, ["date"]),
  }));
}

export function normalizeBingTraffic(
  value: unknown,
): BingStatsReport<BingTrafficRow> {
  return statsReport(value, (row) => ({
    date: text(row, ["date"]),
    clicks: number(row, ["clicks"]),
    impressions: number(row, ["impressions"]),
  }));
}

export function normalizeBingCrawl(
  value: unknown,
): BingStatsReport<BingCrawlRow> {
  return statsReport(value, (row) => ({
    date: text(row, ["date"]),
    code2xx: number(row, ["code_2xx"]),
    code301: number(row, ["code_301"]),
    code302: number(row, ["code_302"]),
    code4xx: number(row, ["code_4xx"]),
    code5xx: number(row, ["code_5xx"]),
    blockedByRobotsTxt: number(row, ["blocked_by_robots_txt"]),
    containsMalware: number(row, ["contains_malware"]),
    crawlErrors: number(row, ["crawl_errors"]),
    crawledPages: number(row, ["crawled_pages"]),
    inIndex: number(row, ["in_index"]),
    inLinks: number(row, ["in_links"]),
    allOtherCodes: number(row, ["all_other_codes"]),
  }));
}

export function normalizeBingUrlInfo(
  value: unknown,
): BingStatsReport<BingUrlInfo> {
  return statsReport(value, (row) => ({
    url: text(row, ["url"]),
    anchorCount: number(row, ["anchor_count"]),
    discoveryDate: text(row, ["discovery_date"]),
    documentSize: number(row, ["document_size"]),
    httpStatus: number(row, ["http_status"]),
    isPage: boolValue(row.is_page),
    lastCrawledDate: text(row, ["last_crawled_date"]),
    totalChildUrlCount: number(row, ["total_child_url_count"]),
  }));
}

export function normalizeBingJoins(
  value: unknown,
): BingStatsReport<BingJoinRow> {
  return statsReport(value, (row) => ({
    query: text(row, ["query"]),
    page: text(row, ["page"]),
    clicks: number(row, ["clicks"]),
    impressions: number(row, ["impressions"]),
    clickPosition: number(row, ["click_position"]),
    impressionPosition: number(row, ["impression_position"]),
    position: number(row, ["position"]),
    date: text(row, ["date"]),
  }));
}

// -- Yandex Metrika --------------------------------------------------------

export interface MetrikaTableRow {
  label: string | null;
  visits: number | null;
  users: number | null;
  bounceRate: number | null;
  avgVisitDurationSeconds: number | null;
  pageDepth: number | null;
  pageviews: number | null;
}

export interface MetrikaTableReport {
  counter: string | null;
  rows: MetrikaTableRow[];
  meta: ReportMeta;
}

function metrikaTable(value: unknown, dimensionKey: string): MetrikaTableReport {
  const data = record(value);
  return {
    counter: stringValue(data.counter),
    rows: records(data.rows).map((row) => ({
      label: text(row, [dimensionKey]),
      visits: number(row, ["visits"]),
      users: number(row, ["users"]),
      bounceRate: number(row, ["bounceRate"]),
      avgVisitDurationSeconds: number(row, [
        "avgVisitDurationSeconds",
      ]),
      pageDepth: number(row, ["pageDepth"]),
      pageviews: number(row, ["pageviews"]),
    })),
    meta: normalizeMeta(value),
  };
}

export function normalizeMetrikaPages(value: unknown): MetrikaTableReport {
  return metrikaTable(value, "startURLPath");
}

export function normalizeMetrikaDevices(value: unknown): MetrikaTableReport {
  return metrikaTable(value, "deviceCategory");
}

export function normalizeMetrikaCountries(value: unknown): MetrikaTableReport {
  return metrikaTable(value, "regionCountry");
}

export interface MetrikaGoalValue {
  id: string;
  reaches: number | null;
  visits: number | null;
  users: number | null;
  conversionRate: number | null;
}

export interface MetrikaGoalRow {
  label: string | null;
  goals: MetrikaGoalValue[];
}

export interface MetrikaGoalsReport {
  counter: string | null;
  goals: string[];
  configured: string[];
  rows: MetrikaGoalRow[];
  meta: ReportMeta;
}

export function normalizeMetrikaGoals(value: unknown): MetrikaGoalsReport {
  const data = record(value);
  const goals = stringList(data.goals);
  return {
    counter: stringValue(data.counter),
    goals,
    configured: stringList(data.goals_configured),
    rows: records(data.rows).map((row) => ({
      label: text(row, ["startURLPath", "lastTrafficSource"]),
      goals: goals.map((id) => ({
        id,
        reaches: numberValue(row[`goal${id}reaches`]),
        visits: numberValue(row[`goal${id}visits`]),
        users: numberValue(row[`goal${id}users`]),
        conversionRate: numberValue(row[`goal${id}conversionRate`]),
      })),
    })),
    meta: normalizeMeta(value),
  };
}

export interface MetrikaEngagement {
  visits: number | null;
  users: number | null;
  bounceRate: number | null;
  avgVisitDurationSeconds: number | null;
  pageDepth: number | null;
  pageviews: number | null;
}

export interface MetrikaEngagementReport {
  counter: string | null;
  row: MetrikaEngagement | null;
  meta: ReportMeta;
}

export function normalizeMetrikaEngagement(
  value: unknown,
): MetrikaEngagementReport {
  const data = record(value);
  const row = records(data.rows)[0] ?? null;
  return {
    counter: stringValue(data.counter),
    row: row
      ? {
          visits: numberValue(row.visits),
          users: numberValue(row.users),
          bounceRate: numberValue(row.bounceRate),
          avgVisitDurationSeconds: numberValue(
            row.avgVisitDurationSeconds,
          ),
          pageDepth: numberValue(row.pageDepth),
          pageviews: numberValue(row.pageviews),
        }
      : null,
    meta: normalizeMeta(value),
  };
}

export interface MetrikaBytimeRow {
  date: string | null;
  visits: number | null;
  users: number | null;
}

export interface MetrikaBytimeReport {
  counter: string | null;
  rows: MetrikaBytimeRow[];
  meta: ReportMeta;
}

export function normalizeMetrikaBytime(value: unknown): MetrikaBytimeReport {
  const data = record(value);
  return {
    counter: stringValue(data.counter),
    rows: records(data.rows).map((row) => ({
      date: text(row, ["date"]),
      visits: number(row, ["visits"]),
      users: number(row, ["users"]),
    })),
    meta: normalizeMeta(value),
  };
}

// -- Core Web Vitals -------------------------------------------------------

export interface CwvCategoryScore {
  category: string | null;
  score: number | null;
}

export interface CwvAuditRow {
  id: string | null;
  title: string | null;
  score: number | null;
  displayValue: string | null;
  description: string | null;
  detailsType: string | null;
  overallSavingsMs: number | null;
  overallSavingsBytes: number | null;
  itemsCount: number | null;
}

export interface CwvAuditsReport {
  url: string | null;
  strategy: string | null;
  categories: CwvCategoryScore[];
  audits: CwvAuditRow[];
  meta: ReportMeta;
}

export function normalizeCwvAudits(value: unknown): CwvAuditsReport {
  const data = record(value);
  return {
    url: stringValue(data.url),
    strategy: stringValue(data.strategy),
    categories: records(data.categories).map((row) => ({
      category: stringValue(row.category),
      score: numberValue(row.score),
    })),
    audits: records(data.audits).map((row) => ({
      id: stringValue(row.id),
      title: stringValue(row.title),
      score: numberValue(row.score),
      displayValue: stringValue(row.display_value),
      description: stringValue(row.description),
      detailsType: stringValue(row.details_type),
      overallSavingsMs: numberValue(row.overall_savings_ms),
      overallSavingsBytes: numberValue(row.overall_savings_bytes),
      itemsCount: numberValue(row.items_count),
    })),
    meta: normalizeMeta(value),
  };
}

export interface CwvHistoryPeriod {
  firstDate: string | null;
  lastDate: string | null;
  device: string | null;
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
  fid: number | null;
}

export interface CwvHistoryReport {
  target: string | null;
  scope: string | null;
  device: string | null;
  weeksRequested: number | null;
  metrics: string[];
  periods: CwvHistoryPeriod[];
  meta: ReportMeta;
}

export function normalizeCwvHistory(value: unknown): CwvHistoryReport {
  const data = record(value);
  return {
    target: stringValue(data.target),
    scope: stringValue(data.scope),
    device: stringValue(data.device),
    weeksRequested: numberValue(data.weeks_requested),
    metrics: stringList(data.metrics),
    periods: records(data.periods).map((row) => ({
      firstDate: stringValue(row.first_date),
      lastDate: stringValue(row.last_date),
      device: stringValue(row.device),
      lcp: numberValue(row.lcp),
      inp: numberValue(row.inp),
      cls: numberValue(row.cls),
      fcp: numberValue(row.fcp),
      ttfb: numberValue(row.ttfb),
      fid: numberValue(row.fid),
    })),
    meta: normalizeMeta(value),
  };
}
