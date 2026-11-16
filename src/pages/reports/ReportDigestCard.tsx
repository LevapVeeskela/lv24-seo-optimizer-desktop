import { useI18n, type MessageKey } from "@/shared/i18n";
import { Badge } from "@/shared/ui/Badge";
import { Card } from "@/shared/ui/Card";
import {
  formatDelta,
  formatMetricValue,
  metricLabelKey,
} from "@/entities/stats/lib/metrics";
import {
  displayEvidenceUrl,
  parseDigest,
  safeEvidenceUrl,
  type DigestConfidence,
  type DigestEvidence,
  type DigestItem,
} from "@/entities/report/model/digest";
import type { ReportSection } from "@/entities/report/model/types";
import "./reportDigest.css";

const CAUSE_KEYS: Record<string, MessageKey> = {
  new_crawl_issue: "reports.digest.cause.new_crawl_issue",
  resolved_crawl_issue: "reports.digest.cause.resolved_crawl_issue",
  indexing_event: "reports.digest.cause.indexing_event",
  page_state: "reports.digest.cause.page_state",
  unexplained: "reports.digest.cause.unexplained",
};

const CAUSE_TONES: Record<string, "neutral" | "success" | "warning" | "info"> = {
  new_crawl_issue: "warning",
  resolved_crawl_issue: "success",
  indexing_event: "info",
  page_state: "info",
  unexplained: "neutral",
};

const CONFIDENCE_KEYS: Record<DigestConfidence, MessageKey> = {
  high: "reports.digest.confidence.high",
  medium: "reports.digest.confidence.medium",
  low: "reports.digest.confidence.low",
  unknown: "reports.digest.confidence.unknown",
};

const CONFIDENCE_TONES: Record<
  DigestConfidence,
  "neutral" | "success" | "warning"
> = {
  high: "success",
  medium: "warning",
  low: "neutral",
  unknown: "neutral",
};

function causeLabel(cause: string, t: (key: MessageKey) => string): string {
  const key = CAUSE_KEYS[cause];
  return key ? t(key) : t("reports.digest.cause.unknown");
}

function evidenceLabel(evidence: DigestEvidence): string {
  if (evidence.kind === "crawl_issue") {
    return evidence.ruleId ?? evidence.kind;
  }
  if (evidence.kind === "indexing_event") {
    return evidence.reason ?? evidence.kind;
  }
  if (evidence.kind === "page_state") {
    return evidence.field
      ? `${evidence.field}${evidence.value ? ` = ${evidence.value}` : ""}`
      : evidence.kind;
  }
  return evidence.kind ?? evidence.ruleId ?? evidence.reason ?? "evidence";
}

function EvidenceRow({ evidence }: { evidence: DigestEvidence }) {
  const { t } = useI18n();
  const href = safeEvidenceUrl(evidence.url);
  const displayUrl = displayEvidenceUrl(evidence.url);
  const details = [evidence.severity, evidence.change, evidence.date].filter(
    (item): item is string => typeof item === "string" && item.trim() !== "",
  );
  return (
    <li>
      <strong>{evidenceLabel(evidence)}</strong>
      {evidence.url ? (
        <>
          {" "}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              title={t("reports.digest.openEvidence")}
            >
              {evidence.url}
            </a>
          ) : (
            <code>{displayUrl}</code>
          )}
        </>
      ) : null}
      {details.length ? (
        <span className="muted small"> · {details.join(" · ")}</span>
      ) : null}
      {Object.keys(evidence.extra).length ? (
        <code className="muted small">
          {" "}
          {JSON.stringify(evidence.extra)}
        </code>
      ) : null}
    </li>
  );
}

function DigestItemView({ item }: { item: DigestItem }) {
  const { t, locale } = useI18n();
  const labelKey = metricLabelKey(item.metric);
  const label = labelKey ? t(labelKey) : item.metric;
  const delta = formatDelta(
    item.metric,
    item.change.current,
    item.change.previous,
    locale,
  );
  return (
    <li className="report-digest-item">
      <div className="card-header">
        <div>
          <h4>{label}</h4>
          <p className="muted small">
            {t("reports.digest.current")}:{" "}
            {formatMetricValue(item.metric, item.change.current, locale)} ·{" "}
            {t("reports.digest.previous")}:{" "}
            {formatMetricValue(item.metric, item.change.previous, locale)}
          </p>
        </div>
        <div className="badge-row">
          <Badge tone={CAUSE_TONES[item.cause] ?? "neutral"}>
            {causeLabel(item.cause, t)}
          </Badge>
          <Badge tone={CONFIDENCE_TONES[item.confidence]}>
            {t(CONFIDENCE_KEYS[item.confidence])}
          </Badge>
        </div>
      </div>

      <p>
        <span className="muted small">{t("reports.digest.change")}: </span>
        {delta ? (
          <span className={`metric-delta ${delta.tone}`}>
            {delta.unit === "percentage_points"
              ? t("delta.percentPoints", { value: delta.text })
              : delta.unit === "percent"
                ? `${delta.text}%`
                : delta.text}
          </span>
        ) : (
          <span className="muted small">{t("delta.noBaseline")}</span>
        )}
      </p>

      <p>
        <span className="muted small">{t("reports.digest.nextAction")}: </span>
        {item.nextAction ?? t("common.notAvailable")}
      </p>

      <div>
        <span className="muted small">{t("reports.digest.evidence")}</span>
        {item.evidence.length ? (
          <ul className="report-digest-evidence">
            {item.evidence.map((evidence, index) => (
              <EvidenceRow key={`${evidence.kind ?? "evidence"}-${index}`} evidence={evidence} />
            ))}
          </ul>
        ) : (
          <p className="muted small">{t("reports.digest.evidenceNone")}</p>
        )}
      </div>
    </li>
  );
}

/**
 * Compact attributed-change card. A report without a `kind: "digest"` section
 * renders nothing; a digest section with no material changes renders its own
 * honest empty state instead of an error.
 */
export function ReportDigestCard({
  section,
}: {
  section: ReportSection | null;
}) {
  const { t } = useI18n();
  const digest = parseDigest(section);
  if (!digest) {
    return null;
  }
  return (
    <Card className="report-digest">
      <div className="card-header">
        <div>
          <p className="eyebrow">{t("reports.digest.title")}</p>
          <h3>{digest.section.summary || t("reports.digest.title")}</h3>
          <p className="muted small">{t("reports.digest.hint")}</p>
        </div>
        <div className="badge-row">
          {digest.truncated ? (
            <Badge tone="warning">
              {t("reports.digest.truncated", {
                shown: digest.items.length,
                total: digest.total,
              })}
            </Badge>
          ) : null}
          {digest.dataAge ? (
            <Badge tone="neutral">
              {t("reports.digest.dataAge", { date: digest.dataAge })}
            </Badge>
          ) : null}
          {digest.skipped > 0 ? (
            <Badge tone="warning">
              {t("reports.digest.skipped", { count: digest.skipped })}
            </Badge>
          ) : null}
        </div>
      </div>

      {digest.items.length ? (
        <ul className="report-digest-items">
          {digest.items.map((item, index) => (
            <DigestItemView key={`${item.metric}-${index}`} item={item} />
          ))}
        </ul>
      ) : (
        <p className="muted">{t("reports.digest.empty")}</p>
      )}

      {digest.limitations.length ? (
        <div className="report-digest-limitations">
          <h4>{t("reports.digest.limitations")}</h4>
          <ul className="report-notes">
            {digest.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
