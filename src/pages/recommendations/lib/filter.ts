import type {
  Recommendation,
  RecommendationSeverity,
  RecommendationTextField,
} from "@/entities/recommendation/model/types";

export type RecommendationSort =
  | "report"
  | "severity-desc"
  | "severity-asc";

const SEVERITY_RANK: Record<RecommendationSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export type TaskTextResolver = (
  recommendation: Recommendation,
  field: RecommendationTextField,
) => string;

export type SourceTextResolver = (
  source: string,
  provider?: string | null,
) => string;

/**
 * Searchable text for one recommendation: the localised task copy plus the
 * English brief fields, the evidence and the provider label. Lower-cased once
 * per item so a query of several words can be matched without re-walking the
 * object for every keystroke.
 */
export function recommendationSearchText(
  recommendation: Recommendation,
  taskText: TaskTextResolver,
  sourceLabel: SourceTextResolver,
  labels: { severity?: string; category?: string } = {},
): string {
  return [
    taskText(recommendation, "title"),
    taskText(recommendation, "action"),
    taskText(recommendation, "verification"),
    recommendation.title,
    recommendation.action,
    recommendation.verification,
    recommendation.query ?? "",
    recommendation.page ?? "",
    sourceLabel(recommendation.source, recommendation.provider),
    recommendation.category,
    recommendation.severity,
    labels.severity ?? "",
    labels.category ?? "",
    ...(recommendation.rule_ids ?? []),
    ...recommendation.evidence.map((row) => `${row.key} ${row.value}`),
  ]
    .join("\n")
    .toLowerCase();
}

/** Every whitespace-separated term must be present; an empty query matches. */
export function matchesSearch(text: string, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => text.includes(term));
}

/** Stable severity sort; ties keep the report order. */
export function sortRecommendations(
  items: readonly Recommendation[],
  sort: RecommendationSort,
): Recommendation[] {
  if (sort === "report") {
    return [...items];
  }
  const direction = sort === "severity-desc" ? 1 : -1;
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const bySeverity =
        (SEVERITY_RANK[left.item.severity] -
          SEVERITY_RANK[right.item.severity]) *
        direction;
      return bySeverity !== 0 ? bySeverity : left.index - right.index;
    })
    .map((entry) => entry.item);
}
