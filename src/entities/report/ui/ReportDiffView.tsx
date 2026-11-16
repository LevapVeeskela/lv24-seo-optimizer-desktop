import { useI18n, type MessageKey } from "@/shared/i18n";
import { formatNumber } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Card } from "@/shared/ui/Card";
import { Table } from "@/shared/ui/Table";
import {
  formatDelta,
  formatMetricValue,
  metricLabelKey,
} from "@/entities/stats/lib/metrics";
import {
  diffChangedIssues,
  diffHasChanges,
  diffPeriodLabel,
  type ReportDiff,
  type ReportDiffIssueRow,
  type ReportDiffMetricRow,
  type ReportDiffOpportunity,
} from "../model/diff";
import { fillCopy, reportDiffCopy } from "../model/copy";

const SEVERITY_KEYS: Record<string, MessageKey> = {
  critical: "severity.critical",
  high: "severity.high",
  medium: "severity.medium",
  low: "severity.low",
  unknown: "severity.unknown",
};

const ARROWS = { up: "↑", down: "↓", flat: "→" } as const;
const MAX_LISTED = 20;

function metricLabel(metric: string, t: (key: MessageKey) => string): string {
  const key = metricLabelKey(metric);
  return key ? t(key) : metric;
}

function signedPercent(value: number | null, locale: string): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const text = formatNumber(Math.abs(value), locale, 2);
  if (value === 0) {
    return `${text}%`;
  }
  return `${value > 0 ? "+" : "−"}${text}%`;
}

/**
 * Read-only rendering of `report_diff`. Every number comes from the engine's
 * structured diff; the view never recomputes a delta from the two values.
 */
export function ReportDiffView({
  diff,
  warnings = [],
}: {
  diff: ReportDiff;
  warnings?: string[];
}) {
  const { t, locale } = useI18n();
  const copy = reportDiffCopy(locale);
  const property = diff.head.property_id ?? diff.base.property_id;
  const previousPeriod = diffPeriodLabel(diff.base);
  const currentPeriod = diffPeriodLabel(diff.head);
  const changedIssues = diffChangedIssues(diff);
  const hasChanges = diffHasChanges(diff);
  const caveats = [...new Set([...diff.limitations, ...warnings])].filter(
    (item) => item.trim() !== "",
  );

  return (
    <Card className="report-diff">
      <div className="card-header">
        <div>
          <p className="eyebrow">{copy.title}</p>
          <h3>
            {previousPeriod ?? t("common.notAvailable")} →{" "}
            {currentPeriod ?? t("common.notAvailable")}
          </h3>
          <p className="muted small">{copy.hint}</p>
        </div>
        <div className="badge-row">
          <Badge tone={diff.comparable ? "success" : "warning"}>
            {diff.comparable ? copy.comparable : copy.notComparable}
          </Badge>
        </div>
      </div>

      <div className="report-facts">
        {property ? (
          <span>
            {copy.property}: <code>{property}</code>
          </span>
        ) : null}
        {diff.base.headline ? (
          <span>
            {copy.previous}: {diff.base.headline}
          </span>
        ) : null}
        {diff.head.headline ? (
          <span>
            {copy.current}: {diff.head.headline}
          </span>
        ) : null}
      </div>

      {!hasChanges ? <p className="muted small">{copy.noChanges}</p> : null}

      {diff.headline.length ? (
        <Table caption={copy.headline}>
          <thead>
            <tr>
              <th>{copy.metric}</th>
              <th>{copy.previous}</th>
              <th>{copy.current}</th>
              <th>{copy.delta}</th>
              <th>{copy.deltaPct}</th>
            </tr>
          </thead>
          <tbody>
            {diff.headline.map((row) => (
              <HeadlineRow key={row.metric} row={row} />
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="muted small">{copy.headlineEmpty}</p>
      )}

      {diff.unknown_metrics.length ? (
        <p className="muted small">
          {fillCopy(copy.unknownMetrics, {
            metrics: diff.unknown_metrics
              .map((metric) => metricLabel(metric, t))
              .join(", "),
          })}
        </p>
      ) : null}

      <h4>{copy.issues}</h4>
      {changedIssues.length ? (
        <Table caption={copy.issues}>
          <thead>
            <tr>
              <th>{t("reports.table.severity")}</th>
              <th>{copy.previous}</th>
              <th>{copy.current}</th>
              <th>{copy.delta}</th>
            </tr>
          </thead>
          <tbody>
            {changedIssues.map((row) => (
              <IssueRow key={row.severity} row={row} />
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="muted small">{copy.issuesEmpty}</p>
      )}

      <h4>{copy.opportunities}</h4>
      {diff.opportunities.added.length || diff.opportunities.resolved.length ? (
        <>
          <OpportunityList title={copy.added} rows={diff.opportunities.added} />
          <OpportunityList
            title={copy.resolved}
            rows={diff.opportunities.resolved}
          />
        </>
      ) : (
        <p className="muted small">{copy.opportunitiesEmpty}</p>
      )}
      {diff.opportunities.unchanged > 0 ? (
        <p className="muted small">
          {fillCopy(copy.unchanged, { count: diff.opportunities.unchanged })}
        </p>
      ) : null}

      <h4>{copy.limitations}</h4>
      {diff.limitations_changed.added.length ||
      diff.limitations_changed.lifted.length ? (
        <>
          <TextList
            title={copy.limitationsAdded}
            items={diff.limitations_changed.added}
          />
          <TextList
            title={copy.limitationsLifted}
            items={diff.limitations_changed.lifted}
          />
        </>
      ) : (
        <p className="muted small">{copy.limitationsEmpty}</p>
      )}

      {caveats.length ? (
        <>
          <h4>{copy.caveats}</h4>
          <ul className="report-notes">
            {caveats.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

function HeadlineRow({ row }: { row: ReportDiffMetricRow }) {
  const { t, locale } = useI18n();
  const copy = reportDiffCopy(locale);
  const delta = formatDelta(row.metric, row.head, row.base, locale);
  const pct = signedPercent(row.pct_delta, locale);
  return (
    <tr>
      <td data-label={copy.metric}>{metricLabel(row.metric, t)}</td>
      <td data-label={copy.previous}>
        {formatMetricValue(row.metric, row.base, locale)}
      </td>
      <td data-label={copy.current}>
        {formatMetricValue(row.metric, row.head, locale)}
      </td>
      <td data-label={copy.delta}>
        {delta ? (
          <span className={`metric-delta ${delta.tone}`}>
            <span aria-hidden="true">{ARROWS[delta.direction]}</span>
            {delta.unit === "percentage_points"
              ? t("delta.percentPoints", { value: delta.text })
              : delta.unit === "percent"
                ? `${delta.text}%`
                : delta.text}
          </span>
        ) : (
          <span className="muted small">{t("common.notAvailable")}</span>
        )}
      </td>
      <td data-label={copy.deltaPct}>
        {pct ?? <span className="muted small">{t("common.notAvailable")}</span>}
      </td>
    </tr>
  );
}

function IssueRow({ row }: { row: ReportDiffIssueRow }) {
  const { t, locale } = useI18n();
  const copy = reportDiffCopy(locale);
  const key = SEVERITY_KEYS[row.severity];
  const tone = row.delta > 0 ? "bad" : row.delta < 0 ? "good" : "neutral";
  const sign = row.delta > 0 ? "+" : "";
  return (
    <tr>
      <td data-label={t("reports.table.severity")}>
        {key ? t(key) : row.severity}
      </td>
      <td data-label={copy.previous}>{formatNumber(row.base, locale)}</td>
      <td data-label={copy.current}>{formatNumber(row.head, locale)}</td>
      <td data-label={copy.delta}>
        <span className={`metric-delta ${tone}`}>
          {sign}
          {formatNumber(row.delta, locale)}
        </span>
      </td>
    </tr>
  );
}

function OpportunityList({
  title,
  rows,
}: {
  title: string;
  rows: ReportDiffOpportunity[];
}) {
  const { locale } = useI18n();
  const copy = reportDiffCopy(locale);
  if (!rows.length) {
    return null;
  }
  const shown = rows.slice(0, MAX_LISTED);
  return (
    <>
      <p className="report-section-summary">
        {title} ({rows.length})
      </p>
      <ul className="report-notes">
        {shown.map((row, index) => (
          <li key={`${row.kind}-${row.query}-${row.page}-${index}`}>
            {[row.kind, row.query].filter(Boolean).join(" · ") || "—"}
            {row.page ? <span className="muted small"> — {row.page}</span> : null}
          </li>
        ))}
        {rows.length > MAX_LISTED ? (
          <li className="muted small">
            {fillCopy(copy.more, { count: rows.length - MAX_LISTED })}
          </li>
        ) : null}
      </ul>
    </>
  );
}

function TextList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) {
    return null;
  }
  return (
    <>
      <p className="report-section-summary">{title}</p>
      <ul className="report-notes">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}
