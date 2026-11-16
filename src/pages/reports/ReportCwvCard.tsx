import { useI18n, type MessageKey } from "@/shared/i18n";
import { Badge } from "@/shared/ui/Badge";
import { Card } from "@/shared/ui/Card";
import { Table } from "@/shared/ui/Table";
import {
  formatCwvDelta,
  formatCwvP75,
  parseCwv,
} from "@/entities/report/model/cwv";
import type { ReportSection } from "@/entities/report/model/types";
import "./reportCwv.css";

const DEVICE_KEYS: Record<string, MessageKey> = {
  phone: "reports.cwv.device.phone",
  desktop: "reports.cwv.device.desktop",
  tablet: "reports.cwv.device.tablet",
  unknown: "reports.cwv.device.unknown",
};

const METRIC_KEYS: Record<string, MessageKey> = {
  largest_contentful_paint: "reports.cwv.metric.lcp",
  interaction_to_next_paint: "reports.cwv.metric.inp",
  cumulative_layout_shift: "reports.cwv.metric.cls",
  first_contentful_paint: "reports.cwv.metric.fcp",
  experimental_time_to_first_byte: "reports.cwv.metric.ttfb",
  first_input_delay: "reports.cwv.metric.fid",
  lcp: "reports.cwv.metric.lcp",
  inp: "reports.cwv.metric.inp",
  cls: "reports.cwv.metric.cls",
  fcp: "reports.cwv.metric.fcp",
  ttfb: "reports.cwv.metric.ttfb",
  fid: "reports.cwv.metric.fid",
};

const LIMITATION_KEYS: Record<string, MessageKey> = {
  cwv_no_rows: "reports.cwv.limitation.cwv_no_rows",
  cwv_template_missing: "reports.cwv.limitation.cwv_template_missing",
  cwv_device_missing: "reports.cwv.limitation.cwv_device_missing",
  cwv_lab_ignored: "reports.cwv.limitation.cwv_lab_ignored",
  cwv_values_ignored: "reports.cwv.limitation.cwv_values_ignored",
  cwv_p75_worst_page: "reports.cwv.limitation.cwv_p75_worst_page",
  cwv_no_comparison: "reports.cwv.limitation.cwv_no_comparison",
};

function deviceLabel(device: string, t: (key: MessageKey) => string): string {
  const key = DEVICE_KEYS[device];
  return key ? t(key) : device;
}

function metricLabel(
  metric: string | null,
  t: (key: MessageKey) => string,
): string | null {
  if (!metric) {
    return null;
  }
  const key = METRIC_KEYS[metric];
  return key ? t(key) : metric;
}

function limitationText(
  code: string,
  t: (key: MessageKey) => string,
): string {
  const key = LIMITATION_KEYS[code];
  return key ? t(key) : code;
}

/**
 * Compact Core Web Vitals card. A report without a `kind: "cwv"` section
 * renders nothing; a section with no trustworthy rows renders its own honest
 * empty state instead of an error. `limitations` carries the CWV-specific
 * report-level caveats the engine stores outside the section.
 */
export function ReportCwvCard({
  section,
  limitations = [],
}: {
  section: ReportSection | null;
  limitations?: readonly string[];
}) {
  const { t, locale } = useI18n();
  const cwv = parseCwv(section, limitations);
  if (!cwv) {
    return null;
  }
  const hasMetric = cwv.rows.some((row) => row.metric !== null);
  return (
    <Card className="report-cwv">
      <div className="card-header">
        <div>
          <p className="eyebrow">{t("reports.cwv.title")}</p>
          <h3>{cwv.section.summary || t("reports.cwv.title")}</h3>
          <p className="muted small">{t("reports.cwv.hint")}</p>
        </div>
        <div className="badge-row">
          {cwv.truncated ? (
            <Badge tone="warning">
              {t("reports.cwv.truncated", {
                shown: cwv.templates,
                total: cwv.total,
              })}
            </Badge>
          ) : null}
          {cwv.dataAge ? (
            <Badge tone="neutral">
              {t("reports.cwv.dataAge", { date: cwv.dataAge })}
            </Badge>
          ) : null}
          {cwv.skipped > 0 ? (
            <Badge tone="warning">
              {t("reports.cwv.skipped", { count: cwv.skipped })}
            </Badge>
          ) : null}
        </div>
      </div>

      {cwv.rows.length ? (
        <Table caption={t("reports.cwv.title")} className="report-cwv-table">
          <thead>
            <tr>
              <th scope="col">{t("reports.cwv.template")}</th>
              <th scope="col">{t("reports.cwv.device")}</th>
              {hasMetric ? (
                <th scope="col">{t("reports.cwv.metric")}</th>
              ) : null}
              <th scope="col">{t("reports.cwv.p75")}</th>
              <th scope="col">{t("reports.cwv.regression")}</th>
            </tr>
          </thead>
          <tbody>
            {cwv.rows.map((row, index) => {
              const delta = formatCwvDelta(row, locale);
              const metric = metricLabel(row.metric, t);
              return (
                <tr key={`${row.template}-${row.device}-${index}`}>
                  <td data-label={t("reports.cwv.template")}>
                    <code>{row.template}</code>
                  </td>
                  <td data-label={t("reports.cwv.device")}>
                    {deviceLabel(row.device, t)}
                  </td>
                  {hasMetric ? (
                    <td data-label={t("reports.cwv.metric")}>
                      {metric ?? t("common.notAvailable")}
                    </td>
                  ) : null}
                  <td data-label={t("reports.cwv.p75")}>
                    {formatCwvP75(row, locale)}
                  </td>
                  <td data-label={t("reports.cwv.regression")}>
                    {row.regression === true ? (
                      <div className="report-cwv-regression">
                        <Badge tone="warning">
                          {t("reports.cwv.regressionYes")}
                        </Badge>
                        {delta ? (
                          <span className="muted small">{delta}</span>
                        ) : null}
                      </div>
                    ) : row.regression === false ? (
                      <Badge tone="success">
                        {t("reports.cwv.regressionNo")}
                      </Badge>
                    ) : (
                      <span className="muted small">
                        {t("reports.cwv.regressionUnknown")}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <p className="muted">{t("reports.cwv.empty")}</p>
      )}

      {cwv.limitations.length ? (
        <div className="report-cwv-limitations">
          <h4>{t("reports.cwv.limitations")}</h4>
          <ul className="report-notes">
            {cwv.limitations.map((item) => (
              <li key={item}>{limitationText(item, t)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
