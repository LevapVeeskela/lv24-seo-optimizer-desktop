import { Fragment } from "react";
import { recommendationSourceLabel } from "@/entities/recommendation/model/copy";
import { useRecommendationCopy } from "@/entities/recommendation/model/useRecommendationCopy";
import type { Recommendation } from "@/entities/recommendation/model/types";
import { useI18n } from "@/shared/i18n";
import { formatNumber } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";

function severityTone(
  severity: Recommendation["severity"],
): "danger" | "warning" | "info" | "neutral" {
  switch (severity) {
    case "critical":
      return "danger";
    case "high":
      return "warning";
    case "medium":
      return "info";
    default:
      return "neutral";
  }
}

function categoryTone(
  category: Recommendation["category"],
): "info" | "warning" | "neutral" {
  if (category === "opportunity") {
    return "info";
  }
  if (category === "crawl" || category === "data_quality") {
    return "warning";
  }
  return "neutral";
}

export function RecommendationCard({
  recommendation,
  inQueue,
  onCopy,
  onAdd,
  onExport,
}: {
  recommendation: Recommendation;
  inQueue: boolean;
  onCopy: () => void;
  onAdd: () => void;
  onExport: () => void;
}) {
  const { locale } = useI18n();
  const copy = useRecommendationCopy();
  const evidenceLabel = (key: string): string =>
    (copy.evidenceLabel as Record<string, string>)[key] ?? key;
  const source = recommendationSourceLabel(
    recommendation.source,
    recommendation.provider,
  );

  return (
    <Card className="service-card">
      <div className="service-card-header">
        <div className="service-card-title">
          <h3>{recommendation.title}</h3>
          <span className="muted small">{source}</span>
        </div>
        <div className="badge-row">
          <Badge tone={severityTone(recommendation.severity)}>
            {copy.severity[recommendation.severity]}
          </Badge>
          <Badge tone={categoryTone(recommendation.category)}>
            {copy.category[recommendation.category]}
          </Badge>
        </div>
      </div>

      {recommendation.query || recommendation.page ? (
        <div className="report-facts">
          {recommendation.query ? (
            <span>
              {copy.query}: <code>{recommendation.query}</code>
            </span>
          ) : null}
          {recommendation.page ? (
            <span>
              {copy.page}: <code>{recommendation.page}</code>
            </span>
          ) : null}
        </div>
      ) : null}

      {recommendation.expected_clicks !== undefined ? (
        <p className="muted small">
          {copy.expectedClicks.replace(
            "{value}",
            formatNumber(recommendation.expected_clicks, locale, 1),
          )}
        </p>
      ) : null}

      <div>
        <h4>{copy.evidence}</h4>
        {recommendation.evidence.length === 0 ? (
          <p className="muted small">{copy.noEvidence}</p>
        ) : (
          <dl className="details">
            {recommendation.evidence.map((item, index) => (
              <Fragment key={`${item.key}-${index}`}>
                <dt>{evidenceLabel(item.key)}</dt>
                <dd>{item.value}</dd>
              </Fragment>
            ))}
          </dl>
        )}
      </div>

      <div>
        <h4>{copy.action}</h4>
        <p>{recommendation.action}</p>
      </div>

      <div>
        <h4>{copy.verification}</h4>
        <p className="muted small">{recommendation.verification}</p>
      </div>

      <div className="row-actions">
        <Button variant="secondary" onClick={onCopy}>
          {copy.copyPrompt}
        </Button>
        <Button variant="secondary" onClick={onAdd} disabled={inQueue}>
          {inQueue
            ? copy.inQueue
            : copy.addToQueue}
        </Button>
        <Button variant="secondary" onClick={onExport}>
          {copy.exportMd}
        </Button>
      </div>
    </Card>
  );
}
