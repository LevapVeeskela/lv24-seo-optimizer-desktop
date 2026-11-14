import { useI18n, type MessageKey } from "@/shared/i18n";
import { formatNumber } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Card } from "@/shared/ui/Card";
import {
  formatDelta,
  formatMetricValue,
  metricLabelKey,
} from "@/entities/stats/lib/metrics";
import {
  serviceLabel,
  type ServiceStatus,
  type StatsProvider,
  type StatsService,
} from "@/entities/stats/model/types";

type CardStatus = ServiceStatus | "not_returned";

const STATUS_KEYS: Record<CardStatus, MessageKey> = {
  ok: "status.ok",
  no_data: "status.no_data",
  missing_token: "status.missing_token",
  not_configured: "status.not_configured",
  error: "status.error",
  not_returned: "status.not_returned",
};

const DIRECTION_KEYS = {
  up: "delta.up",
  down: "delta.down",
  flat: "delta.flat",
} as const;

function statusTone(status: CardStatus) {
  if (status === "ok") {
    return "success" as const;
  }
  if (status === "error") {
    return "danger" as const;
  }
  if (status === "no_data" || status === "missing_token") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function deltaText(delta: NonNullable<ReturnType<typeof formatDelta>>, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  if (delta.unit === "percentage_points") {
    return t("delta.percentPoints", { value: delta.text });
  }
  if (delta.unit === "percent") {
    return `${delta.text}%`;
  }
  return delta.text;
}

const ARROWS = { up: "↑", down: "↓", flat: "→" } as const;

export function ServiceCard({
  provider,
  service,
}: {
  provider: StatsProvider;
  service?: StatsService;
}) {
  const { t, locale } = useI18n();
  const status: CardStatus = service?.status ?? "not_returned";
  const statusKey = STATUS_KEYS[status] ?? "status.unknown";
  const metrics = service?.metrics ?? {};
  const entries = Object.entries(metrics);
  const previous = service?.previous ?? null;

  return (
    <Card className="service-card">
      <div className="service-card-header">
        <div className="service-card-title">
          <h3>{serviceLabel(service, provider)}</h3>
          <code>{provider}</code>
        </div>
        <Badge tone={statusTone(status)}>{t(statusKey)}</Badge>
      </div>

      {service ? (
        <div className="badge-row">
          <Badge tone={service.configured ? "success" : "neutral"}>
            {service.configured
              ? t("service.configured")
              : t("service.notConfigured")}
          </Badge>
          <Badge tone={service.ready ? "success" : "warning"}>
            {service.ready ? t("service.ready") : t("service.notReady")}
          </Badge>
          {service.truncated ? (
            <Badge tone="warning">{t("service.truncated")}</Badge>
          ) : null}
        </div>
      ) : null}

      {entries.length > 0 ? (
        <dl className="service-metrics">
          {entries.map(([metric, value]) => {
            const labelKey = metricLabelKey(metric);
            const label =
              metric === "position"
                ? t("metric.positionLower")
                : labelKey
                  ? t(labelKey)
                  : metric;
            const delta = formatDelta(
              metric,
              value,
              previous?.[metric],
              locale,
            );
            return (
              <div className="service-metric" key={metric}>
                <dt>{label}</dt>
                <dd>
                  {formatMetricValue(
                    metric,
                    value,
                    locale,
                    service?.units?.[metric],
                  )}
                </dd>
                {delta ? (
                  <div
                    className={`metric-delta ${delta.tone}`}
                    aria-label={`${t(DIRECTION_KEYS[delta.direction])} ${deltaText(delta, t)} ${t("delta.vsPrevious")}`}
                  >
                    <span className="arrow" aria-hidden="true">
                      {ARROWS[delta.direction]}
                    </span>
                    <span>{deltaText(delta, t)}</span>
                    <span className="sr-only">{t("delta.vsPrevious")}</span>
                  </div>
                ) : previous && value != null ? (
                  <div className="metric-delta neutral">
                    {t("delta.noBaseline")}
                  </div>
                ) : null}
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="muted small">{t("service.noMetrics")}</p>
      )}

      {service ? (
        <div className="service-facts">
          <span>
            {t("service.rows")}: {formatNumber(service.rows, locale)}
          </span>
          {typeof service.data_age_days === "number" ? (
            <span>{t("service.dataAge", { days: service.data_age_days })}</span>
          ) : null}
        </div>
      ) : null}

      {service?.error ? (
        <p className="inline-error">
          {service.error.code}: {service.error.message}
        </p>
      ) : null}

      {service?.limitations?.length ? (
        <div>
          <h4>{t("service.limitations")}</h4>
          <ul className="service-list">
            {service.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {service?.warnings?.length ? (
        <div>
          <h4>{t("service.warnings")}</h4>
          <ul className="service-list">
            {service.warnings.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
