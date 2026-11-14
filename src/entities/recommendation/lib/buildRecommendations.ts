import type {
  ReportRow,
  ReportSection,
  WeeklyReport,
} from "@/entities/report/model/types";
import { reportSections } from "@/entities/report/model/types";
import {
  PROVIDER_LABELS,
  type ServiceStatus,
  type StatsData,
  type StatsProvider,
  type StatsService,
} from "@/entities/stats/model/types";
import { isRecord, numberValue, stringValue } from "@/shared/lib/format";
import type {
  Recommendation,
  RecommendationCategory,
  RecommendationEvidence,
  RecommendationSeverity,
} from "../model/types";

type AddRecommendation = (recommendation: Recommendation) => void;

const OPPORTUNITY_KINDS = new Set(["striking_distance", "ctr_gap", "decay"]);

const SERVICE_STATUSES = new Set<ServiceStatus>([
  "ok",
  "no_data",
  "missing_token",
  "not_configured",
  "error",
]);

const SEVERITY_RANK: Record<RecommendationSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const CATEGORY_RANK: Record<RecommendationCategory, number> = {
  opportunity: 0,
  crawl: 1,
  configuration: 2,
  data_quality: 3,
};

const PROVIDER_ALIASES: Record<string, string> = {
  yandex: "yandex_webmaster",
  metrika: "yandex_metrika",
  "yandex-metrika": "yandex_metrika",
  "yandex-webmaster": "yandex_webmaster",
};

/**
 * Pure workbench builder over the weekly report and the read-only stats
 * payload. It produces scoped tasks with stable ids and never fills missing
 * URLs, metrics or provider values.
 */
export function buildRecommendations(
  report: WeeklyReport | null,
  stats: StatsData | null,
): Recommendation[] {
  const collected: Recommendation[] = [];
  const seen = new Set<string>();
  const add: AddRecommendation = (recommendation) => {
    if (seen.has(recommendation.id)) {
      return;
    }
    seen.add(recommendation.id);
    collected.push(recommendation);
  };

  const services = stats?.services ?? [];
  const coveredProviders = new Set<string>();
  for (const service of services) {
    // `stats` always lists every known service, so presence alone proves
    // nothing. A provider only covers the report when it actually returned
    // rows; an `ok` service with zero rows is still a missing-data gap.
    if (service.status === "ok" && service.rows > 0) {
      coveredProviders.add(normalizeProvider(service.provider));
    }
    addServiceRecommendations(service, add);
  }

  for (const section of reportSections(report)) {
    if (section.key === "opportunities") {
      addOpportunityRecommendations(section, add);
    } else if (section.key === "issues") {
      addIssueRecommendations(section, add);
    } else if (section.key === "sources") {
      addSourceRecommendations(section, coveredProviders, add);
    }
  }

  for (const limitation of stringArray(report?.limitations)) {
    addLimitation(limitation, "report", null, "limitation", add);
  }
  for (const limitation of stringArray(stats?.limitations)) {
    addLimitation(limitation, "stats", null, "limitation", add);
  }
  for (const service of services) {
    for (const limitation of stringArray(service.limitations)) {
      addLimitation(limitation, "stats", service.provider, "limitation", add);
    }
  }

  return collected.sort(compareRecommendations);
}

/** Stable id for a recommendation identity. Same input, same id. */
export function stableRecommendationId(
  category: RecommendationCategory,
  source: string,
  key: string,
): string {
  const slug =
    key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "item";
  return `${category}:${source}:${slug}-${stableHash(key)}`;
}

/**
 * Opportunity severity from the modelled upside. Decay is a loss signal, so
 * it never falls below medium; a missing estimate is medium, never low.
 */
export function opportunitySeverity(
  kind: string,
  expectedClicks: number | null,
): RecommendationSeverity {
  if (kind === "decay") {
    return expectedClicks !== null && expectedClicks >= 10 ? "high" : "medium";
  }
  if (expectedClicks === null) {
    return "medium";
  }
  if (expectedClicks >= 25) {
    return "high";
  }
  if (expectedClicks >= 5) {
    return "medium";
  }
  return "low";
}

/** Map a report severity string; unknown values stay medium, never invented. */
export function normalizeSeverity(value: unknown): RecommendationSeverity {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    text === "critical" ||
    text === "high" ||
    text === "medium" ||
    text === "low"
  ) {
    return text;
  }
  return "medium";
}

function addOpportunityRecommendations(
  section: ReportSection,
  add: AddRecommendation,
): void {
  const rows = reportRows(section);
  const notes = stringArray(section.notes);
  if (rows.length === 0) {
    const note = notes.find((item) => /no gsc query rows/i.test(item));
    if (note) {
      add(missingOpportunitiesRecommendation(note));
    }
    return;
  }

  for (const row of rows) {
    const kind = stringValue(row.kind)?.trim();
    const query = stringValue(row.query)?.trim();
    if (!kind || !OPPORTUNITY_KINDS.has(kind) || !query) {
      continue;
    }
    const page = stringValue(row.page)?.trim() || null;
    const expected = positiveNumber(row.expected_clicks);
    const rawEvidence = isRecord(row.evidence) ? row.evidence : {};
    const position = positiveNumber(row.position ?? rawEvidence.position);
    const title = opportunityTitle(kind, query, position);
    const action = opportunityAction(kind, page !== null);
    const verification = opportunityVerification(kind);
    const evidence = opportunityEvidence(kind, row, rawEvidence);

    add({
      id: stableRecommendationId(
        "opportunity",
        "gsc",
        `${kind}|${query}|${page ?? ""}`,
      ),
      category: "opportunity",
      severity: opportunitySeverity(kind, expected),
      source: "gsc",
      provider: "gsc",
      title,
      action,
      verification,
      evidence,
      query,
      ...(page ? { page } : {}),
      ...(expected !== null ? { expected_clicks: expected } : {}),
    });
  }
}

function addIssueRecommendations(
  section: ReportSection,
  add: AddRecommendation,
): void {
  const rows = reportRows(section);
  const notes = stringArray(section.notes);
  if (rows.length === 0) {
    const note = notes.find((item) => /no issue rows/i.test(item));
    if (note) {
      add(missingIssuesRecommendation(note));
    }
    return;
  }

  for (const row of rows) {
    const count = positiveNumber(row.count);
    if (count === null) {
      continue;
    }
    const rawSeverity = stringValue(row.severity)?.trim();
    const severity = normalizeSeverity(row.severity);
    const ruleIds = stringArray(row.rule_ids).sort();
    const evidence: RecommendationEvidence[] = [];
    pushString(evidence, "severity", rawSeverity ?? severity);
    if (
      rawSeverity &&
      rawSeverity.toLowerCase() !== severity
    ) {
      pushString(evidence, "mapped_severity", severity);
    }
    pushNumber(evidence, "count", count);
    pushString(evidence, "rule_ids", ruleIds.join(", "));
    const ruleText = ruleIds.length
      ? ` for rules ${ruleIds.join(", ")}`
      : "";

    add({
      id: stableRecommendationId(
        "crawl",
        "crawl",
        `${severity}|${ruleIds.join(",") || "no-rules"}`,
      ),
      category: "crawl",
      severity,
      source: "crawl",
      provider: "crawl",
      title: `Fix ${numberText(count)} ${severity} crawl issue${count === 1 ? "" : "s"}`,
      action: `Review the stored crawl findings${ruleText} and fix the affected templates or URLs. Read affected URLs from the crawl output; never invent URLs.`,
      verification:
        "Re-run lv24-seo crawl with the same URL budget and confirm this rule count drops; recrawl and indexing delays can hide the fix.",
      evidence,
      count,
      ...(ruleIds.length ? { rule_ids: ruleIds } : {}),
    });
  }
}

function addSourceRecommendations(
  section: ReportSection,
  coveredProviders: Set<string>,
  add: AddRecommendation,
): void {
  const rows = reportRows(section);
  const notes = stringArray(section.notes);
  for (const row of rows) {
    const source = stringValue(row.source)?.trim();
    if (!source) {
      continue;
    }
    const provider = normalizeProvider(source);
    const label = providerLabel(provider);
    const status = stringValue(row.status)?.trim();
    const kind = stringValue(row.kind)?.trim();
    const limitations = stringArray(row.limitations);

    for (const limitation of limitations) {
      addLimitation(limitation, "report", provider, "limitation", add);
    }

    if (status === "missing" && !coveredProviders.has(provider)) {
      const evidence: RecommendationEvidence[] = [];
      pushString(evidence, "status", status);
      pushString(evidence, "kind", kind);
      pushString(evidence, "limitations", limitations.join("; "));
      add({
        id: stableRecommendationId(
          "data_quality",
          "report",
          `${provider}|missing`,
        ),
        category: "data_quality",
        severity: "medium",
        source: "report",
        provider,
        title: `No ${label} rows in the weekly report`,
        action: `Confirm the ${label} target and token, then rebuild the weekly report for the same period. Missing rows are not zero traffic.`,
        verification: `lv24-seo doctor --json and lv24-seo report weekly --json should show rows for this provider; otherwise keep the limitation in the report.`,
        evidence,
        status: "missing",
      });
    }
  }

  for (const note of notes) {
    const parsed = limitationNote(note);
    if (parsed) {
      addLimitation(parsed.text, "report", null, parsed.kind, add);
    }
  }
}

function addServiceRecommendations(
  service: StatsService,
  add: AddRecommendation,
): void {
  const provider = normalizeProvider(service.provider);
  const label = providerLabel(provider);
  const status = service.status;
  if (!SERVICE_STATUSES.has(status)) {
    return;
  }

  if (status === "ok") {
    if (service.truncated) {
      add(truncatedServiceRecommendation(service, provider, label));
    }
    return;
  }

  const category: RecommendationCategory =
    status === "missing_token" || status === "not_configured"
      ? "configuration"
      : "data_quality";
  const severity: RecommendationSeverity =
    status === "missing_token" || status === "error" ? "high" : "medium";
  const evidence: RecommendationEvidence[] = [];
  pushString(evidence, "status", status);
  pushBoolean(evidence, "configured", service.configured);
  pushBoolean(evidence, "ready", service.ready);
  pushNumber(evidence, "rows", service.rows);
  pushNumber(evidence, "data_age_days", service.data_age_days);
  if (service.error) {
    pushString(evidence, "error_code", service.error.code);
    pushString(evidence, "error_message", service.error.message);
  }

  add({
    id: stableRecommendationId(
      category,
      "stats",
      `${provider}|${status}`,
    ),
    category,
    severity,
    source: "stats",
    provider,
    title: serviceTitle(status, label),
    action: serviceAction(status, label),
    verification: serviceVerification(status),
    evidence,
    status,
  });
}

function truncatedServiceRecommendation(
  service: StatsService,
  provider: string,
  label: string,
): Recommendation {
  const evidence: RecommendationEvidence[] = [];
  pushString(evidence, "status", "ok");
  pushString(evidence, "truncated", "yes");
  pushNumber(evidence, "rows", service.rows);
  pushNumber(evidence, "data_age_days", service.data_age_days);

  return {
    id: stableRecommendationId("data_quality", "stats", `${provider}|truncated`),
    category: "data_quality",
    severity: "low",
    source: "stats",
    provider,
    title: `${label} data is truncated`,
    action: `Treat ${label} totals as partial. Narrow the date range or raise the row cap only if the provider quota allows it; keep the truncation visible in the report.`,
    verification:
      "Refresh stats and rebuild the weekly report; confirm truncated=false or keep the limitation documented.",
    evidence,
    status: "ok",
  };
}

function missingOpportunitiesRecommendation(note: string): Recommendation {
  return {
    id: stableRecommendationId(
      "data_quality",
      "report",
      "opportunities|missing",
    ),
    category: "data_quality",
    severity: "medium",
    source: "report",
    provider: "gsc",
    title: "No query rows for opportunities",
    action:
      "Confirm GSC query data for the period, then rebuild the weekly report. Do not infer opportunities from missing rows.",
    verification:
      'lv24-seo report weekly --json should include opportunity rows or keep the "no GSC query rows" note visible.',
    evidence: [{ key: "note", value: note.trim() }],
    status: "missing",
  };
}

function missingIssuesRecommendation(note: string): Recommendation {
  return {
    id: stableRecommendationId("data_quality", "report", "issues|missing"),
    category: "data_quality",
    severity: "medium",
    source: "report",
    provider: "crawl",
    title: "No crawl issue rows in the weekly report",
    action:
      "Run lv24-seo crawl for the property before treating the report as a clean bill of health. Missing issue rows are not proof that the site is clean.",
    verification:
      'Rebuild the weekly report; it should include issue rows or keep the "no issue rows" note visible.',
    evidence: [{ key: "note", value: note.trim() }],
    status: "missing",
  };
}

function addLimitation(
  rawText: string,
  source: string,
  provider: string | null,
  kind: "limitation" | "caveat",
  add: AddRecommendation,
): void {
  const text = rawText.trim();
  if (!text) {
    return;
  }
  const normalizedProvider = provider ? normalizeProvider(provider) : null;
  const label = normalizedProvider
    ? providerLabel(normalizedProvider)
    : source === "stats"
      ? "Provider statistics"
      : "Weekly report";
  const normalizedText = text.toLowerCase().replace(/\s+/g, " ");
  const evidence: RecommendationEvidence[] = [];
  if (normalizedProvider) {
    pushString(evidence, "provider", providerLabel(normalizedProvider));
  }
  evidence.push({ key: kind, value: text });

  add({
    id: stableRecommendationId(
      "data_quality",
      "limitation",
      `${kind}|${normalizedText}`,
    ),
    category: "data_quality",
    severity: "low",
    source,
    ...(normalizedProvider ? { provider: normalizedProvider } : {}),
    title:
      kind === "caveat"
        ? `Data caveat from ${label}`
        : `Data limitation from ${label}`,
    action:
      kind === "caveat"
        ? "Keep this caveat visible when comparing engines; do not merge values across engines or windows with different sampling."
        : "Keep this limitation visible in the report and adjust conclusions; re-run the provider when the limitation is resolved. Do not present capped or partial data as complete.",
    verification: `Re-run lv24-seo stats --json and lv24-seo report weekly --json; confirm the ${kind} is gone or still listed in limitations[].`,
    evidence,
  });
}

function opportunityTitle(
  kind: string,
  query: string,
  position: number | null,
): string {
  if (kind === "decay") {
    return `Recover lost clicks for "${query}"`;
  }
  if (kind === "ctr_gap") {
    return position !== null
      ? `Close the CTR gap for "${query}" at position ${decimalText(position)}`
      : `Close the CTR gap for "${query}"`;
  }
  return position !== null
    ? `Move "${query}" from position ${decimalText(position)} into the top results`
    : `Win more clicks for "${query}"`;
}

function opportunityAction(kind: string, hasPage: boolean): string {
  if (kind === "decay") {
    return hasPage
      ? "Find what changed for this page and query, restore the lost content or internal links, and rule out seasonality before editing."
      : "Find which page lost visibility for this query, restore the lost content or internal links, and rule out seasonality; do not invent a URL.";
  }
  if (kind === "ctr_gap") {
    return hasPage
      ? "Rewrite the title and meta description of the ranking page to close the CTR gap at its current position; change one element at a time."
      : "Identify the ranking page for this query, then rewrite its title and meta description to close the CTR gap; do not invent a URL.";
  }
  return hasPage
    ? "Strengthen the title, H1 and snippet of the ranking page for this query; align the content with search intent before requesting a recrawl."
    : "Choose the page that should own this query, then strengthen its title, H1 and snippet; do not invent a URL.";
}

function opportunityVerification(kind: string): string {
  if (kind === "decay") {
    return "Rebuild the weekly report for the same period and compare clicks with the previous window; confirm the query recovers before closing the task.";
  }
  if (kind === "ctr_gap") {
    return "Rebuild the weekly report for the same period after the snippet change is live and compare CTR at the same position; a position shift can explain CTR changes, so check both.";
  }
  return "Rebuild the weekly report for the same period after the page is recrawled and compare position and clicks for this query. Expect movement only after indexing.";
}

function opportunityEvidence(
  kind: string,
  row: ReportRow,
  raw: Record<string, unknown>,
): RecommendationEvidence[] {
  const evidence: RecommendationEvidence[] = [];
  if (kind === "striking_distance") {
    pushDecimal(evidence, "position", raw.position ?? row.position);
    pushNumber(evidence, "impressions", raw.impressions ?? row.impressions);
    pushString(evidence, "position_band", raw.position_band);
    pushPercent(evidence, "ctr_lift", raw.ctr_lift);
  } else if (kind === "ctr_gap") {
    pushDecimal(evidence, "position", raw.position ?? row.position);
    pushNumber(evidence, "impressions", raw.impressions ?? row.impressions);
    pushPercent(evidence, "ctr", raw.ctr ?? row.ctr);
    pushPercent(evidence, "expected_ctr", raw.expected_ctr);
  } else {
    pushNumber(evidence, "previous_clicks", raw.previous_clicks);
    pushNumber(evidence, "clicks", raw.clicks ?? row.clicks);
    pushNumber(
      evidence,
      "previous_impressions",
      raw.previous_impressions,
    );
    pushPercent(evidence, "decay_ratio", raw.decay_ratio);
    pushString(evidence, "match", raw.match);
  }
  return evidence;
}

function serviceTitle(status: ServiceStatus, label: string): string {
  switch (status) {
    case "missing_token":
      return `Connect ${label}: token missing`;
    case "not_configured":
      return `Configure ${label}`;
    case "no_data":
      return `No ${label} data for this period`;
    case "error":
      return `${label} returned an error`;
    default:
      return `${label} status`;
  }
}

function serviceAction(status: ServiceStatus, label: string): string {
  switch (status) {
    case "missing_token":
      return `Store the ${label} token outside the repository (OS keychain or LV24_SEO_* environment variable), then run lv24-seo auth status and lv24-seo doctor. Never paste the token into a task, log or commit.`;
    case "not_configured":
      return `Add the ${label} target to seo.toml, then run lv24-seo doctor and refresh stats.`;
    case "no_data":
      return "Check the property id, date range and provider lag, then refresh stats. Missing rows are not zero traffic.";
    case "error":
      return "Read the provider error, fix the credential, quota or property issue, then refresh stats. Do not retry in a loop.";
    default:
      return "Review the provider status and refresh stats.";
  }
}

function serviceVerification(status: ServiceStatus): string {
  switch (status) {
    case "missing_token":
      return "lv24-seo auth status --json and lv24-seo stats --json should report this provider as present and not missing_token.";
    case "not_configured":
      return "lv24-seo properties --json should list the target and lv24-seo stats --json should stop reporting not_configured.";
    case "no_data":
      return "Refresh stats for the same period; if rows are still absent, keep the limitation in the report instead of treating the value as zero.";
    case "error":
      return "Refresh stats once the provider is reachable; confirm status is ok or no_data, not error.";
    default:
      return "Refresh stats and confirm the provider status.";
  }
}

function limitationNote(
  note: string,
): { kind: "limitation" | "caveat"; text: string } | null {
  const match = /^(limitation|caveat):\s*(.+)$/i.exec(note.trim());
  if (!match) {
    return null;
  }
  const kind = match[1].toLowerCase() === "caveat" ? "caveat" : "limitation";
  const text = match[2].trim();
  return text ? { kind, text } : null;
}

function compareRecommendations(
  left: Recommendation,
  right: Recommendation,
): number {
  const severity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  if (severity !== 0) {
    return severity;
  }
  const category = CATEGORY_RANK[left.category] - CATEGORY_RANK[right.category];
  if (category !== 0) {
    return category;
  }
  const expected =
    (right.expected_clicks ?? 0) - (left.expected_clicks ?? 0);
  if (expected !== 0) {
    return expected;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

function normalizeProvider(provider: string): string {
  const key = provider.trim().toLowerCase();
  return PROVIDER_ALIASES[key] ?? key;
}

function providerLabel(provider: string): string {
  const label = PROVIDER_LABELS[provider as StatsProvider];
  if (label) {
    return label;
  }
  if (provider === "crawl") {
    return "Site crawl";
  }
  if (provider === "report") {
    return "Weekly report";
  }
  if (provider === "stats") {
    return "Provider statistics";
  }
  return provider;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function positiveNumber(value: unknown): number | null {
  const number = numberValue(value);
  return number !== null && number > 0 ? number : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function reportRows(section: ReportSection): ReportRow[] {
  return Array.isArray(section.rows)
    ? section.rows.filter((row): row is ReportRow => isRecord(row))
    : [];
}

function pushString(
  items: RecommendationEvidence[],
  key: string,
  value: unknown,
): void {
  const raw = stringValue(value);
  if (!raw) {
    return;
  }
  const text = raw.trim().replace(/\s+/g, " ");
  if (text) {
    items.push({ key, value: text });
  }
}

function pushNumber(
  items: RecommendationEvidence[],
  key: string,
  value: unknown,
): void {
  const number = positiveNumber(value);
  if (number !== null) {
    items.push({ key, value: numberText(number) });
  }
}

function pushDecimal(
  items: RecommendationEvidence[],
  key: string,
  value: unknown,
): void {
  const number = positiveNumber(value);
  if (number !== null) {
    items.push({ key, value: decimalText(number) });
  }
}

function pushPercent(
  items: RecommendationEvidence[],
  key: string,
  value: unknown,
): void {
  const number = positiveNumber(value);
  if (number !== null) {
    items.push({ key, value: percentText(number) });
  }
}

function pushBoolean(
  items: RecommendationEvidence[],
  key: string,
  value: unknown,
): void {
  if (typeof value === "boolean") {
    items.push({ key, value: value ? "yes" : "no" });
  }
}

function numberText(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Math.round(value * 10) / 10);
}

function decimalText(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function percentText(value: number): string {
  return `${numberText(Math.round(value * 10000) / 100)}%`;
}
