import type { MessageKey, MessageParams } from "@/shared/i18n";
import type {
  Recommendation,
  RecommendationCategory,
  RecommendationSeverity,
  RecommendationTextField,
} from "./types";

const severityLabels: Record<RecommendationSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const categoryLabels: Record<RecommendationCategory, string> = {
  opportunity: "Opportunity",
  crawl: "Crawl fix",
  configuration: "Configuration",
  data_quality: "Data quality",
};

const sourceLabels: Record<string, string> = {
  gsc: "Google Search Console",
  yandex_webmaster: "Yandex Webmaster",
  yandex_metrika: "Yandex Metrika",
  bing: "Bing Webmaster",
  crux: "Chrome UX Report (CrUX)",
  psi: "PageSpeed Insights (PSI)",
  crawl: "Site crawl",
  report: "Weekly report",
  stats: "Provider statistics",
};

const evidenceLabels: Record<string, string> = {
  position: "Position",
  impressions: "Impressions",
  clicks: "Clicks",
  ctr: "CTR",
  expected_ctr: "Expected CTR",
  position_band: "Position band",
  ctr_lift: "Modelled CTR lift",
  previous_clicks: "Previous clicks",
  previous_impressions: "Previous impressions",
  decay_ratio: "Decay threshold",
  match: "Decay match",
  severity: "Severity",
  mapped_severity: "Mapped severity",
  count: "Count",
  rule_ids: "Rule IDs",
  status: "Status",
  configured: "Configured",
  ready: "Ready",
  rows: "Rows",
  data_age_days: "Data age (days)",
  truncated: "Truncated",
  error_code: "Provider error code",
  error_message: "Provider error",
  limitation: "Limitation",
  caveat: "Caveat",
  provider: "Provider",
  kind: "Engine kind",
  note: "Report note",
};

const statusLabels = {
  draft: "Draft",
  copied: "Copied",
  exported: "Exported",
} as const;

/**
 * English source strings for the recommendations workbench. The orchestrator
 * can replace this object with an i18n-backed implementation without touching
 * the builder, prompt or queue logic.
 */
export const recommendationCopy = {
  title: "Recommendations",
  subtitle:
    "Turn the weekly report into scoped, verifiable agent tasks. Nothing is sent to a provider or submitted from this screen.",
  loading: "Loading recommendations…",
  buildWeekly: "Build weekly",
  building: "Building…",
  refreshStats: "Refresh stats",
  refreshing: "Refreshing…",
  retry: "Retry",
  offlineTitle: "Engine offline",
  offlineHint:
    "The desktop shell is not connected to the lv24-seo engine, so report data cannot be loaded.",
  reportError: "Could not build the weekly report.",
  reportBuilt: "Weekly report built.",
  statsError: "Could not load provider statistics.",
  reportMissingTitle: "No weekly report in this session",
  reportMissingHint:
    "Build a weekly report to collect opportunities, crawl issues and provider gaps.",
  emptyTitle: "No actionable recommendations",
  emptyHint:
    "The report has no opportunity, crawl or data-quality items. Refresh stats or rebuild the report for a new period.",
  filteredEmptyTitle: "No items match these filters",
  filteredEmptyHint: "Reset the filters to see every recommendation.",
  resetFilters: "Reset filters",
  filters: {
    source: "Source",
    severity: "Severity",
    allSources: "All sources",
    allSeverities: "All severities",
  },
  property: "Property",
  period: "Period",
  generated: "Generated {value}",
  query: "Query",
  page: "Page",
  evidence: "Evidence",
  action: "Recommended action",
  verification: "Verification",
  noEvidence: "No evidence rows were provided.",
  expectedClicks: "~{value} clicks/week (estimate)",
  copyPrompt: "Copy prompt",
  copied: "Prompt copied.",
  copyFailed: "Could not copy the prompt.",
  addToQueue: "Add to queue",
  inQueue: "In queue",
  addedToQueue: "Added to the agent queue.",
  exportMd: "Export .md",
  exported: "Markdown task exported.",
  exportFailed: "Could not export the task.",
  queueTitle: "Agent queue",
  queueHint: "Drafts stay in this browser until you remove them.",
  queueEmpty:
    "The queue is empty. Add a recommendation to keep its prompt and status.",
  queueClear: "Clear queue",
  queueCleared: "Queue cleared.",
  remove: "Remove",
  removed: "Removed from the queue.",
  severity: severityLabels,
  category: categoryLabels,
  source: sourceLabels,
  evidenceLabel: evidenceLabels,
  status: statusLabels,
} as const;

/** Human label for a recommendation origin plus an optional provider. */
export function recommendationSourceLabel(
  source: string,
  provider?: string | null,
): string {
  const sourceLabel = recommendationCopy.source[source] ?? source;
  if (!provider) {
    return sourceLabel;
  }
  const providerLabel = recommendationCopy.source[provider] ?? provider;
  return providerLabel === sourceLabel
    ? sourceLabel
    : `${sourceLabel} · ${providerLabel}`;
}

/** Evidence label with a raw-key fallback for future builder fields. */
export function recommendationEvidenceLabel(key: string): string {
  return recommendationCopy.evidenceLabel[key] ?? key;
}

/**
 * Message keys for the provider/source label used inside task copy. Product
 * names are shared by all locales; the generic origins are translated.
 */
export const PROVIDER_LABEL_KEYS: Record<string, MessageKey> = {
  gsc: "recommendations.provider.gsc",
  yandex_webmaster: "recommendations.provider.yandex_webmaster",
  yandex_metrika: "recommendations.provider.yandex_metrika",
  bing: "recommendations.provider.bing",
  crux: "recommendations.provider.crux",
  psi: "recommendations.provider.psi",
  crawl: "recommendations.provider.crawl",
  report: "recommendations.provider.report",
  stats: "recommendations.provider.stats",
};

/**
 * Resolve one localisable task field. Older queued tasks have no `i18n` block,
 * so the English text stored on the recommendation is the fallback. The
 * `{label}` placeholder is resolved here, where the active locale is known.
 */
export function recommendationTaskText(
  recommendation: Recommendation,
  field: RecommendationTextField,
  translate: (key: MessageKey, params?: MessageParams) => string,
  providerLabel: (id: string) => string,
): string {
  const text = recommendation.i18n;
  if (!text) {
    return recommendation[field];
  }
  const params: MessageParams = { ...(text.params ?? {}) };
  if (params.label !== undefined) {
    params.label = providerLabel(recommendation.provider ?? recommendation.source);
  }
  return translate(text[field], params);
}

