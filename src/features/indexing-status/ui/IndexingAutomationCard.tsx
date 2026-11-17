import { useEffect } from "react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { useI18n, type MessageKey } from "@/shared/i18n";
import { type AppError } from "@/shared/lib/errors";
import { formatDateTime, formatNumber } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { Table } from "@/shared/ui/Table";
import {
  INDEXING_HISTORY_LIMIT,
  type IndexingStatusStore,
} from "../model/IndexingStatusStore";
import {
  providerNotReady,
  type IndexingDayBucket,
  type IndexingProvider,
  type IndexingProviderStatus,
  type IndexingQuota,
  type IndexingRun,
  type ScheduleJobState,
} from "../model/types";
import "./indexing-status.css";

const PROVIDER_LABEL_KEYS: Record<IndexingProvider, MessageKey> = {
  bing: "indexingAuto.provider.bing",
  yandex: "indexingAuto.provider.yandex",
  gsc: "indexingAuto.provider.gsc",
  indexnow: "indexingAuto.provider.indexnow",
};

const SCHEDULE_STATE_KEYS: Record<ScheduleJobState, MessageKey> = {
  installed: "indexingAuto.scheduled",
  outdated: "indexingAuto.state.outdated",
  partial: "indexingAuto.state.partial",
  missing: "indexingAuto.state.missing",
  unknown: "indexingAuto.state.unknown",
};

function scheduleTone(
  state: ScheduleJobState | null,
): "neutral" | "success" | "warning" {
  if (state === "installed") {
    return "success";
  }
  if (state === "outdated" || state === "partial") {
    return "warning";
  }
  return "neutral";
}

function providerText(
  provider: string | null,
  t: (key: MessageKey) => string,
): string {
  if (!provider || provider === "unknown") {
    return "—";
  }
  const key = PROVIDER_LABEL_KEYS[provider as IndexingProvider];
  return key ? t(key) : provider;
}

function QuotaCell({
  provider,
  quota,
}: {
  provider: IndexingProvider;
  quota: IndexingQuota | null;
}) {
  const { t, locale } = useI18n();
  if (!quota) {
    return <>{t("indexingAuto.noData")}</>;
  }
  const number = (value: number | null): string =>
    value === null ? t("indexingAuto.noData") : formatNumber(value, locale);
  if (provider === "bing") {
    const daily = quota.dailyRemaining ?? quota.remaining;
    const monthly = quota.monthlyRemaining ?? quota.remaining;
    return (
      <span className="indexing-status-quota">
        <span>{t("indexingAuto.quota.daily", { value: number(daily) })}</span>
        <span>{t("indexingAuto.quota.monthly", { value: number(monthly) })}</span>
      </span>
    );
  }
  if (provider === "yandex") {
    return (
      <span className="indexing-status-quota">
        <span>
          {t("indexingAuto.quota.remaining", {
            value: number(quota.remaining),
          })}
        </span>
      </span>
    );
  }
  return (
    <span className="indexing-status-quota">
      <span>
        {t("indexingAuto.quota.usedLimit", {
          used: number(quota.used),
          limit: number(quota.limit),
        })}
      </span>
    </span>
  );
}

function ProviderCell({
  provider,
  entry,
}: {
  provider: IndexingProvider;
  entry: IndexingProviderStatus | null;
}) {
  const { t } = useI18n();
  return (
    <span className="indexing-status-provider">
      <strong>{t(PROVIDER_LABEL_KEYS[provider])}</strong>
      {entry?.propertyId ? (
        <small className="muted">{entry.propertyId}</small>
      ) : null}
      {entry && providerNotReady(entry) ? (
        <small className="muted">{t("indexingAuto.notReady")}</small>
      ) : null}
    </span>
  );
}

function ErrorItems({ run }: { run: IndexingRun }) {
  const { t } = useI18n();
  const items = run.errorItems.slice(0, 5);
  const hidden = run.errorItems.length - items.length;
  if (!items.length) {
    return null;
  }
  return (
    <div>
      <h4>{t("indexingAuto.errorItems")}</h4>
      <ul className="service-list indexing-status-errors">
        {items.map((item, index) => (
          <li key={`${item.code ?? "error"}-${item.url ?? index}`}>
            {item.code ? <code>{item.code}</code> : null}{" "}
            {item.url ? <span>{item.url}</span> : null}{" "}
            {item.message ? (
              <span className="muted">{item.message}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="muted small">
          {t("indexingAuto.errorItemsMore", { count: hidden })}
        </p>
      ) : null}
    </div>
  );
}

function LastRun({ run }: { run: IndexingRun | null }) {
  const { t, locale } = useI18n();
  if (!run) {
    return <p className="muted small">{t("indexingAuto.noRuns")}</p>;
  }
  const value = (item: number | null): string =>
    item === null ? t("common.notAvailable") : formatNumber(item, locale);
  return (
    <>
      <div className="indexing-status-facts">
        <div className="indexing-status-fact">
          <span className="muted small">{t("indexingAuto.run.status")}</span>
          <strong>{run.status ?? t("common.notAvailable")}</strong>
        </div>
        <div className="indexing-status-fact">
          <span className="muted small">{t("indexingAuto.run.provider")}</span>
          <strong>{providerText(run.provider, t)}</strong>
        </div>
        <div className="indexing-status-fact">
          <span className="muted small">{t("indexingAuto.run.started")}</span>
          <strong>
            {run.startedAt
              ? formatDateTime(run.startedAt, locale)
              : t("common.notAvailable")}
          </strong>
        </div>
        <div className="indexing-status-fact">
          <span className="muted small">{t("indexingAuto.run.submitted")}</span>
          <strong>{value(run.submitted)}</strong>
        </div>
        <div className="indexing-status-fact">
          <span className="muted small">{t("indexingAuto.run.checked")}</span>
          <strong>{value(run.checked)}</strong>
        </div>
        <div className="indexing-status-fact">
          <span className="muted small">{t("indexingAuto.run.errors")}</span>
          <strong>{value(run.errors)}</strong>
        </div>
      </div>
      <ErrorItems run={run} />
    </>
  );
}

function HistoryTable({ buckets }: { buckets: IndexingDayBucket[] }) {
  const { t, locale } = useI18n();
  if (!buckets.length) {
    return <p className="muted small">{t("indexingAuto.noRuns")}</p>;
  }
  const value = (item: number | null): string =>
    item === null ? t("common.notAvailable") : formatNumber(item, locale);
  return (
    <Table caption={t("indexingAuto.history.title")}>
      <thead>
        <tr>
          <th scope="col">{t("indexingAuto.history.day")}</th>
          <th scope="col">{t("indexingAuto.history.provider")}</th>
          <th scope="col">{t("indexingAuto.history.runs")}</th>
          <th scope="col">{t("indexingAuto.history.submitted")}</th>
          <th scope="col">{t("indexingAuto.history.checked")}</th>
        </tr>
      </thead>
      <tbody>
        {buckets.map((bucket) => (
          <tr key={`${bucket.day}-${bucket.provider}`}>
            <td>
              {bucket.day === "unknown"
                ? t("common.notAvailable")
                : bucket.day}
            </td>
            <td>{providerText(bucket.provider, t)}</td>
            <td>{formatNumber(bucket.runs, locale)}</td>
            <td>{value(bucket.submitted)}</td>
            <td>{value(bucket.checked)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function errorNotice(error: AppError): {
  message: string;
  nextAction: string | null;
  code: string;
} {
  return {
    message: error.message,
    nextAction: error.nextAction ?? null,
    code: error.code,
  };
}

function SecondaryError({
  title,
  error,
}: {
  title: string;
  error: { message: string; nextAction: string | null };
}) {
  const { t } = useI18n();
  return (
    <p className="muted small">
      {title} {error.message}
      {error.nextAction ? (
        <>
          {" "}
          <strong>{t("indexingAuto.nextAction")}</strong> {error.nextAction}
        </>
      ) : null}
    </p>
  );
}

export interface IndexingAutomationCardProps {
  store: IndexingStatusStore;
  configPath: string | null;
  offline: boolean;
  loading: boolean;
  platform: string | null | undefined;
}

/**
 * Read-only Indexing automation card for the Integrations page.
 *
 * It renders the quota-aware queue snapshot, the newest run and a compact
 * day/provider history. There is no write control, no confirm token and no
 * provider credential on this surface; the scheduled job belongs to the host
 * scheduler.
 */
export const IndexingAutomationCard = observer(
  function IndexingAutomationCard({
    store,
    configPath,
    offline,
    loading,
    platform,
  }: IndexingAutomationCardProps) {
    const { t, locale } = useI18n();
    const blocked = offline || loading || !configPath;

    useEffect(() => {
      if (blocked || !configPath) {
        return;
      }
      void store.load(configPath, platform);
    }, [blocked, configPath, platform, store]);

    const scheduleState = store.schedule?.state ?? null;
    const scheduleLabel = scheduleState
      ? t(SCHEDULE_STATE_KEYS[scheduleState])
      : t("indexingAuto.state.unknown");
    const status = store.status;
    const history = store.history;
    const providers = Object.values(status?.providers ?? {});
    const empty =
      store.state === "ready" &&
      !store.engineOutdated &&
      (history?.runs.length ?? 0) === 0 &&
      providers.every((entry) => providerNotReady(entry));
    const gsc = status?.providers.gsc ?? null;
    const dataAge =
      status?.dataAgeDays === null || status?.dataAgeDays === undefined
        ? t("indexingAuto.dataAgeUnknown")
        : t("indexingAuto.dataAgeValue", {
            days: formatNumber(status.dataAgeDays, locale),
          });
    const statusError = store.error ? errorNotice(store.error) : null;
    const historyError = store.historyError
      ? errorNotice(store.historyError)
      : null;
    const scheduleError = store.scheduleError
      ? errorNotice(store.scheduleError)
      : null;

    return (
      <Card>
        <div className="card-header">
          <div>
            <h2>{t("indexingAuto.title")}</h2>
            <p className="muted small">{t("indexingAuto.subtitle")}</p>
            <p className="muted small">
              {t("indexingAuto.cadence", { time: "04:00" })}
            </p>
          </div>
          <div className="badge-row">
            <Badge tone={scheduleTone(scheduleState)}>{scheduleLabel}</Badge>
            <Badge tone="neutral">{t("indexingAuto.readOnly")}</Badge>
            <Button
              variant="secondary"
              loading={store.loading}
              disabled={blocked || store.loading}
              onClick={() => void store.load(configPath, platform)}
            >
              {store.loading
                ? t("indexingAuto.refreshing")
                : t("indexingAuto.refresh")}
            </Button>
          </div>
        </div>

        {offline ? (
          <Notice variant="info">
            <strong>{t("indexingAuto.offlineTitle")}</strong>
            <span>{t("indexingAuto.offlineHint")}</span>
          </Notice>
        ) : null}

        {!configPath && !offline && !loading ? (
          <Notice
            variant="info"
            action={
              <Link className="btn btn-secondary" to="/settings">
                {t("indexingAuto.openSettings")}
              </Link>
            }
          >
            <strong>{t("indexingAuto.noWorkspaceTitle")}</strong>
            <span>{t("indexingAuto.noWorkspaceHint")}</span>
          </Notice>
        ) : null}

        {store.engineOutdated ? (
          <Notice variant="error">
            <strong>{t("indexingAuto.needsEngine")}</strong>
            <span>{t("indexingAuto.needsEngineHint")}</span>
          </Notice>
        ) : null}

        {statusError && !store.engineOutdated ? (
          <Notice
            variant="error"
            action={
              <Button
                variant="secondary"
                disabled={blocked || store.loading}
                onClick={() => void store.load(configPath, platform)}
              >
                {t("common.retry")}
              </Button>
            }
          >
            <strong>{t("indexingAuto.errorTitle")}</strong>
            <span>{statusError.message}</span>
            {statusError.nextAction ? (
              <span>
                <strong>{t("indexingAuto.nextAction")}</strong>{" "}
                {statusError.nextAction}
              </span>
            ) : null}
            <code className="callback">
              {t("integrations.errorCode", { code: statusError.code })}
            </code>
          </Notice>
        ) : null}

        {scheduleError && !store.engineOutdated ? (
          <SecondaryError
            title={t("indexingAuto.scheduleError")}
            error={scheduleError}
          />
        ) : null}

        {store.loading ? (
          <Loading label={t("indexingAuto.refreshing")} />
        ) : null}

        {empty ? (
          <EmptyState
            title={t("indexingAuto.emptyTitle")}
            hint={t("indexingAuto.emptyHint")}
          />
        ) : null}

        {status && !store.engineOutdated && !empty ? (
          <section
            className="indexing-status-section"
            aria-labelledby="indexing-auto-providers"
          >
            <div className="card-header">
              <div>
                <h3 id="indexing-auto-providers">
                  {t("indexingAuto.providers.title")}
                </h3>
                <p className="muted small">
                  {t("indexingAuto.providers.hint")}
                </p>
              </div>
            </div>
            <Table caption={t("indexingAuto.providers.title")}>
              <thead>
                <tr>
                  <th scope="col">{t("indexingAuto.column.provider")}</th>
                  <th scope="col">{t("indexingAuto.column.submitted")}</th>
                  <th scope="col">{t("indexingAuto.column.indexed")}</th>
                  <th scope="col">{t("indexingAuto.column.pending")}</th>
                  <th scope="col">{t("indexingAuto.column.quota")}</th>
                </tr>
              </thead>
              <tbody>
                {store.providerRows.map(({ provider, entry }) => {
                  const ready = entry !== null && !providerNotReady(entry);
                  const count = (value: number | null): string =>
                    ready && value !== null
                      ? formatNumber(value, locale)
                      : t("indexingAuto.noData");
                  return (
                    <tr key={provider}>
                      <td>
                        <ProviderCell provider={provider} entry={entry} />
                      </td>
                      <td>{count(entry?.submitted ?? null)}</td>
                      <td>
                        {provider === "gsc"
                          ? count(entry?.indexed ?? null)
                          : "—"}
                      </td>
                      <td>{count(entry?.pending ?? null)}</td>
                      <td>
                        {ready ? (
                          <QuotaCell
                            provider={provider}
                            quota={entry?.quota ?? null}
                          />
                        ) : (
                          t("indexingAuto.noData")
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>

            {gsc && gsc.indexedTotal !== null ? (
              <p className="muted small">
                {t("indexingAuto.indexedTotal", {
                  value: formatNumber(gsc.indexedTotal, locale),
                  source: gsc.indexedTotalSource ?? "—",
                })}{" "}
                {t("indexingAuto.deprecatedAggregate")}
              </p>
            ) : null}

            {status.truncated ? (
              <p className="muted small">{t("indexingAuto.truncated")}</p>
            ) : null}
          </section>
        ) : null}

        {!store.engineOutdated && !empty && history ? (
          <section
            className="indexing-status-section"
            aria-labelledby="indexing-auto-last-run"
          >
            <div className="card-header">
              <div>
                <h3 id="indexing-auto-last-run">
                  {t("indexingAuto.lastRun.title")}
                </h3>
                <p className="muted small">
                  {t("indexingAuto.lastRun.hint")}
                </p>
              </div>
            </div>
            <LastRun run={store.lastRun} />
          </section>
        ) : null}

        {historyError && !store.engineOutdated ? (
          <SecondaryError
            title={t("indexingAuto.historyError")}
            error={historyError}
          />
        ) : null}

        {history && !store.engineOutdated && !empty ? (
          <section
            className="indexing-status-section"
            aria-labelledby="indexing-auto-history"
          >
            <div className="card-header">
              <div>
                <h3 id="indexing-auto-history">
                  {t("indexingAuto.history.title")}
                </h3>
                <p className="muted small">
                  {t("indexingAuto.history.hint", {
                    limit: INDEXING_HISTORY_LIMIT,
                  })}
                </p>
              </div>
            </div>
            <p className="muted small">
              {t("indexingAuto.history.window", {
                days: 7,
                runs: store.recent7.runs,
                submitted:
                  store.recent7.submitted === null
                    ? t("common.notAvailable")
                    : formatNumber(store.recent7.submitted, locale),
                checked:
                  store.recent7.checked === null
                    ? t("common.notAvailable")
                    : formatNumber(store.recent7.checked, locale),
              })}
            </p>
            <p className="muted small">
              {t("indexingAuto.history.window", {
                days: 30,
                runs: store.recent30.runs,
                submitted:
                  store.recent30.submitted === null
                    ? t("common.notAvailable")
                    : formatNumber(store.recent30.submitted, locale),
                checked:
                  store.recent30.checked === null
                    ? t("common.notAvailable")
                    : formatNumber(store.recent30.checked, locale),
              })}
            </p>
            <HistoryTable buckets={store.dayBuckets} />
          </section>
        ) : null}

        {!store.engineOutdated ? (
          <section
            className="indexing-status-meta"
            aria-labelledby="indexing-auto-meta"
          >
            <div className="card-header">
              <div>
                <h3 id="indexing-auto-meta">
                  {t("indexingAuto.meta.title")}
                </h3>
                <p className="muted small">
                  {t("indexingAuto.dataAge", { value: dataAge })}
                </p>
              </div>
            </div>
            {store.limitations.length ? (
              <>
                <h4>{t("indexingAuto.limitations")}</h4>
                <ul className="service-list">
                  {store.limitations.map((item) => (
                    <li key={item}>
                      <code>{item}</code>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted small">
                {t("indexingAuto.noLimitations")}
              </p>
            )}
          </section>
        ) : null}
      </Card>
    );
  },
);
