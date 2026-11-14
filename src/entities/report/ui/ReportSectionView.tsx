import { useI18n, type MessageKey } from "@/shared/i18n";
import { formatNumber, numberValue } from "@/shared/lib/format";
import { Table } from "@/shared/ui/Table";
import {
  formatDelta,
  formatMetricValue,
  metricLabelKey,
} from "@/entities/stats/lib/metrics";
import type { ReportRow, ReportSection } from "@/entities/report/model/types";

const SECTION_KEYS: Record<string, MessageKey> = {
  headline: "reports.section.headline",
  traffic: "reports.section.traffic",
  opportunities: "reports.section.opportunities",
  issues: "reports.section.issues",
  sources: "reports.section.sources",
};

const SEVERITY_KEYS: Record<string, MessageKey> = {
  critical: "severity.critical",
  high: "severity.high",
  medium: "severity.medium",
  low: "severity.low",
  unknown: "severity.unknown",
};

const ARROWS = { up: "↑", down: "↓", flat: "→" } as const;

function text(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "—";
}

function list(value: unknown): string {
  if (!Array.isArray(value)) {
    return "—";
  }
  const items = value.filter(
    (item): item is string => typeof item === "string" && item.trim() !== "",
  );
  return items.length ? items.join("; ") : "—";
}

function metricName(metric: unknown): string | null {
  return typeof metric === "string" && metric.trim() ? metric : null;
}

export function ReportSectionView({ section }: { section: ReportSection }) {
  const { t } = useI18n();
  const titleKey = SECTION_KEYS[section.key];
  const title = titleKey ? t(titleKey) : section.title;
  const rows = Array.isArray(section.rows) ? section.rows : [];
  const notes = Array.isArray(section.notes) ? section.notes : [];

  return (
    <section className="card report-section">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          {section.summary ? <p className="report-section-summary">{section.summary}</p> : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="muted small">{t("common.none")}</p>
      ) : section.key === "headline" ? (
        <HeadlineTable rows={rows} />
      ) : section.key === "traffic" ? (
        <TrafficTable rows={rows} />
      ) : section.key === "opportunities" ? (
        <OpportunitiesTable rows={rows} />
      ) : section.key === "issues" ? (
        <IssuesTable rows={rows} />
      ) : section.key === "sources" ? (
        <SourcesTable rows={rows} />
      ) : (
        <p className="muted small">{t("reports.unknownSection")}</p>
      )}

      {notes.length ? (
        <ul className="report-notes">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function HeadlineTable({ rows }: { rows: ReportRow[] }) {
  const { t, locale } = useI18n();
  return (
    <Table caption={t("reports.section.headline")}>
      <thead>
        <tr>
          <th>{t("reports.table.metric")}</th>
          <th>{t("reports.table.current")}</th>
          <th>{t("reports.table.previous")}</th>
          <th>{t("reports.table.change")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const metric = metricName(row.metric);
          const labelKey = metric ? metricLabelKey(metric) : null;
          const label = metric
            ? labelKey
              ? t(labelKey)
              : metric
            : "—";
          const current = numberValue(row.current);
          const previous = numberValue(row.previous);
          const delta = metric ? formatDelta(metric, current, previous, locale) : null;
          return (
            <tr key={`${metric ?? "row"}-${index}`}>
              <td data-label={t("reports.table.metric")}>{label}</td>
              <td data-label={t("reports.table.current")}>
                {metric ? formatMetricValue(metric, current, locale) : "—"}
              </td>
              <td data-label={t("reports.table.previous")}>
                {metric ? formatMetricValue(metric, previous, locale) : "—"}
              </td>
              <td data-label={t("reports.table.change")}>
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
                  <span className="muted small">{t("delta.noBaseline")}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function TrafficTable({ rows }: { rows: ReportRow[] }) {
  const { t, locale } = useI18n();
  return (
    <Table caption={t("reports.section.traffic")}>
      <thead>
        <tr>
          <th>{t("reports.table.engine")}</th>
          <th>{t("reports.table.rows")}</th>
          <th>{t("reports.table.clicks")}</th>
          <th>{t("reports.table.impressions")}</th>
          <th>{t("reports.table.ctr")}</th>
          <th>{t("reports.table.position")}</th>
          <th>{t("reports.table.limitations")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${text(row.engine)}-${index}`}>
            <td data-label={t("reports.table.engine")}>{text(row.engine)}</td>
            <td data-label={t("reports.table.rows")}>
              {formatNumber(numberValue(row.rows), locale)}
            </td>
            <td data-label={t("reports.table.clicks")}>
              {formatNumber(numberValue(row.clicks), locale)}
            </td>
            <td data-label={t("reports.table.impressions")}>
              {formatNumber(numberValue(row.impressions), locale)}
            </td>
            <td data-label={t("reports.table.ctr")}>
              {formatMetricValue("ctr", numberValue(row.ctr), locale)}
            </td>
            <td data-label={t("reports.table.position")}>
              {formatMetricValue("position", numberValue(row.position), locale)}
            </td>
            <td data-label={t("reports.table.limitations")}>
              {list(row.limitations)}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function OpportunitiesTable({ rows }: { rows: ReportRow[] }) {
  const { t, locale } = useI18n();
  return (
    <Table caption={t("reports.section.opportunities")}>
      <thead>
        <tr>
          <th>{t("reports.table.kind")}</th>
          <th>{t("reports.table.query")}</th>
          <th>{t("reports.table.page")}</th>
          <th>{t("reports.table.clicks")}</th>
          <th>{t("reports.table.impressions")}</th>
          <th>{t("reports.table.ctr")}</th>
          <th>{t("reports.table.position")}</th>
          <th>{t("reports.table.expectedClicks")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${text(row.query)}-${index}`}>
            <td data-label={t("reports.table.kind")}>{text(row.kind)}</td>
            <td data-label={t("reports.table.query")}>{text(row.query)}</td>
            <td data-label={t("reports.table.page")}>{text(row.page)}</td>
            <td data-label={t("reports.table.clicks")}>
              {formatNumber(numberValue(row.clicks), locale)}
            </td>
            <td data-label={t("reports.table.impressions")}>
              {formatNumber(numberValue(row.impressions), locale)}
            </td>
            <td data-label={t("reports.table.ctr")}>
              {formatMetricValue("ctr", numberValue(row.ctr), locale)}
            </td>
            <td data-label={t("reports.table.position")}>
              {formatMetricValue("position", numberValue(row.position), locale)}
            </td>
            <td data-label={t("reports.table.expectedClicks")}>
              {formatNumber(numberValue(row.expected_clicks), locale, 1)}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function IssuesTable({ rows }: { rows: ReportRow[] }) {
  const { t } = useI18n();
  return (
    <Table caption={t("reports.section.issues")}>
      <thead>
        <tr>
          <th>{t("reports.table.severity")}</th>
          <th>{t("reports.table.count")}</th>
          <th>{t("reports.table.ruleIds")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const severity = text(row.severity);
          const key = SEVERITY_KEYS[severity];
          return (
            <tr key={`${severity}-${index}`}>
              <td data-label={t("reports.table.severity")}>
                {key ? t(key) : severity}
              </td>
              <td data-label={t("reports.table.count")}>{text(row.count)}</td>
              <td data-label={t("reports.table.ruleIds")}>
                {list(row.rule_ids)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function SourcesTable({ rows }: { rows: ReportRow[] }) {
  const { t } = useI18n();
  return (
    <Table caption={t("reports.section.sources")}>
      <thead>
        <tr>
          <th>{t("reports.table.source")}</th>
          <th>{t("reports.table.status")}</th>
          <th>{t("reports.table.rows")}</th>
          <th>{t("reports.table.kind")}</th>
          <th>{t("reports.table.limitations")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${text(row.source)}-${index}`}>
            <td data-label={t("reports.table.source")}>{text(row.source)}</td>
            <td data-label={t("reports.table.status")}>{text(row.status)}</td>
            <td data-label={t("reports.table.rows")}>{text(row.rows)}</td>
            <td data-label={t("reports.table.kind")}>{text(row.kind)}</td>
            <td data-label={t("reports.table.limitations")}>
              {list(row.limitations)}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
