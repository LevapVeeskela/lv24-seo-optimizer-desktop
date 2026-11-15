import type { WeeklyReport } from "@/entities/report/model/types";
import type { StatsData } from "@/entities/stats/model/types";
import type { MessageKey, MessageParams } from "@/shared/i18n";
import { isRecord } from "@/shared/lib/format";

export const RECOMMENDATION_CATEGORIES = [
  "opportunity",
  "crawl",
  "configuration",
  "data_quality",
] as const;

export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];

export const RECOMMENDATION_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
] as const;

export type RecommendationSeverity = (typeof RECOMMENDATION_SEVERITIES)[number];

export type RecommendationTextField = "title" | "action" | "verification";

/**
 * One human-readable evidence row. `key` stays machine-stable so the UI can
 * localise the label; `value` is already a safe display string.
 */
export interface RecommendationEvidence {
  key: string;
  value: string;
}

/**
 * Localised task copy. `title`/`action`/`verification` on the recommendation
 * stay English (the agent brief is English); the card renders these keys with
 * `params` and the provider label resolved for the active locale.
 */
export interface RecommendationText {
  title: MessageKey;
  action: MessageKey;
  verification: MessageKey;
  /** `label` is replaced with the localised provider/source label at render. */
  params?: MessageParams;
}

/**
 * A scoped, verifiable task derived from a weekly report and/or stats payload.
 * The builder never invents URLs, queries, metrics or providers: optional
 * fields are absent when the source did not report them.
 */
export interface Recommendation {
  id: string;
  category: RecommendationCategory;
  severity: RecommendationSeverity;
  /** Origin of the task: a provider id, `crawl`, `report` or `stats`. */
  source: string;
  /** Provider id when the task is tied to one provider. */
  provider?: string;
  title: string;
  action: string;
  verification: string;
  i18n?: RecommendationText;
  evidence: RecommendationEvidence[];
  query?: string;
  page?: string;
  expected_clicks?: number;
  rule_ids?: string[];
  count?: number;
  status?: string;
}

export interface RecommendationPeriod {
  start: string;
  end: string;
}

export interface RecommendationContext {
  property: string | null;
  period: RecommendationPeriod | null;
}

export function isRecommendationCategory(
  value: unknown,
): value is RecommendationCategory {
  return (
    typeof value === "string" &&
    (RECOMMENDATION_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isRecommendationSeverity(
  value: unknown,
): value is RecommendationSeverity {
  return (
    typeof value === "string" &&
    (RECOMMENDATION_SEVERITIES as readonly string[]).includes(value)
  );
}

function isEvidence(value: unknown): value is RecommendationEvidence {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.value === "string"
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isMessageParams(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      Object.values(value).every(
        (item) => typeof item === "string" || typeof item === "number",
      ))
  );
}

function isRecommendationText(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      typeof value.title === "string" &&
      typeof value.action === "string" &&
      typeof value.verification === "string" &&
      isMessageParams(value.params))
  );
}

function isOptionalPositiveNumber(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value > 0)
  );
}

/** Runtime guard used by the localStorage queue parser. */
export function isRecommendation(value: unknown): value is Recommendation {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.id !== "string" ||
    !value.id.trim() ||
    !isRecommendationCategory(value.category) ||
    !isRecommendationSeverity(value.severity) ||
    typeof value.source !== "string" ||
    !value.source.trim() ||
    typeof value.title !== "string" ||
    typeof value.action !== "string" ||
    typeof value.verification !== "string" ||
    !isRecommendationText(value.i18n) ||
    !Array.isArray(value.evidence) ||
    !value.evidence.every(isEvidence)
  ) {
    return false;
  }
  if (
    !isOptionalString(value.provider) ||
    !isOptionalString(value.query) ||
    !isOptionalString(value.page) ||
    !isOptionalString(value.status) ||
    !isOptionalPositiveNumber(value.expected_clicks) ||
    !isOptionalPositiveNumber(value.count)
  ) {
    return false;
  }
  if (
    value.rule_ids !== undefined &&
    (!Array.isArray(value.rule_ids) ||
      !value.rule_ids.every((item) => typeof item === "string"))
  ) {
    return false;
  }
  return true;
}

/**
 * Property and period shown in the prompt. The weekly report wins; stats only
 * fills the period when a report is not available.
 */
export function recommendationContext(
  report: WeeklyReport | null,
  stats: StatsData | null,
): RecommendationContext {
  const property =
    typeof report?.property_id === "string" && report.property_id.trim()
      ? report.property_id.trim()
      : null;
  const period = report?.period ?? stats?.period ?? null;
  return {
    property,
    period: period ? { start: period.start, end: period.end } : null,
  };
}
