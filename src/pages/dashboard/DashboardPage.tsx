import { useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import { Link, useNavigate } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n } from "@/shared/i18n";
import { appErrorText } from "@/shared/lib/errors";
import { formatDateTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { useFeedback } from "@/shared/ui/Feedback";
import { CoverageStrip } from "@/entities/stats/ui/CoverageStrip";
import { ServiceCard } from "@/entities/stats/ui/ServiceCard";
import { STATS_PROVIDERS } from "@/entities/stats/model/types";

export const DashboardPage = observer(function DashboardPage() {
  const { t, locale } = useI18n();
  const { engine, stats, reports } = useRootStore();
  const navigate = useNavigate();
  const { notify } = useFeedback();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const configPath = engine.status?.configPath ?? null;
  const blocked = engine.offline || engine.loading || !configPath;

  useEffect(() => {
    // Without a workspace configuration `stats` is a guaranteed failure.
    if (!engine.loading && !engine.offline && configPath && stats.state === "idle") {
      void stats.refresh();
    }
  }, [engine.loading, engine.offline, configPath, stats]);

  const reconnect = async () => {
    await engine.load();
    // Read the fresh status: the shell may have reported a config path.
    if (!engine.offline && engine.status?.configPath) {
      await stats.refresh();
    }
  };

  const buildWeekly = async () => {
    if (blocked) {
      return;
    }
    const ok = await reports.buildWeekly();
    if (ok) {
      notify(t("reports.built"));
      navigate("/reports");
      return;
    }
    notify(
      reports.error ? appErrorText(reports.error) : t("reports.buildFailed"),
      "error",
    );
  };

  const requestBuild = () => {
    if (!blocked) {
      setConfirmOpen(true);
    }
  };

  const data = stats.data;
  const services = data?.services ?? [];
  const serviceByProvider = new Map(
    services.map((service) => [service.provider, service]),
  );
  const warnings = [
    ...new Set([...(data?.warnings ?? []), ...stats.warnings]),
  ].filter((item) => typeof item === "string" && item.trim());

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{t("dashboard.title")}</h1>
          <p className="muted">{t("dashboard.subtitle")}</p>
        </div>
        <div className="page-actions">
          <Button
            variant="secondary"
            loading={stats.loading}
            onClick={() => void stats.refresh()}
            disabled={blocked}
          >
            {stats.loading
              ? t("actions.refreshing")
              : t("actions.refreshStats")}
          </Button>
          <Button
            variant="primary"
            loading={reports.loading}
            onClick={requestBuild}
            disabled={blocked}
          >
            {reports.loading
              ? t("actions.building")
              : t("actions.buildWeekly")}
          </Button>
          <Link className="btn btn-secondary" to="/reports">
            {t("actions.openReport")}
          </Link>
        </div>
      </header>

      {engine.offline ? (
        <Notice
          variant="info"
          action={
            <Button variant="secondary" onClick={() => void reconnect()}>
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("dashboard.offlineTitle")}</strong>
          <span>{t("dashboard.offlineHint")}</span>
        </Notice>
      ) : null}

      {stats.error ? (
        <Notice
          variant="error"
          action={
            <Button
              variant="secondary"
              onClick={() => void stats.refresh()}
              disabled={blocked}
            >
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("dashboard.error")}</strong>
          <span>{appErrorText(stats.error)}</span>
        </Notice>
      ) : null}

      {stats.loading && !data ? <Loading label={t("dashboard.loading")} /> : null}

      {!configPath && !engine.loading && !engine.offline ? (
        <Card>
          <EmptyState
            title={t("dashboard.noConfigTitle")}
            hint={t("dashboard.noConfigHint")}
            action={
              <Link className="btn btn-primary" to="/settings">
                {t("dashboard.openSettings")}
              </Link>
            }
          />
        </Card>
      ) : null}

      {configPath && !data && !stats.loading && !stats.error && !engine.offline ? (
        <Card>
          <EmptyState
            title={t("dashboard.emptyTitle")}
            hint={t("dashboard.emptyHint")}
            action={
              <Button variant="primary" onClick={() => void stats.refresh()}>
                {t("actions.refreshStats")}
              </Button>
            }
          />
        </Card>
      ) : null}

      {data ? (
        <>
          <Card>
            <div className="card-header">
              <div>
                <h2>{t("dashboard.coverage")}</h2>
                <p className="muted small">{t("dashboard.coverageHint")}</p>
              </div>
            </div>
            <CoverageStrip coverage={data.coverage} />
            <div className="report-facts dashboard-facts">
              {data.period ? (
                <span>
                  {t("dashboard.period", {
                    start: data.period.start,
                    end: data.period.end,
                  })}
                </span>
              ) : null}
              {data.previous_period ? (
                <span>
                  {t("dashboard.previousPeriod", {
                    start: data.previous_period.start,
                    end: data.previous_period.end,
                  })}
                </span>
              ) : null}
              {data.generated_at ? (
                <span>
                  {t("dashboard.generatedAt", {
                    value: formatDateTime(data.generated_at, locale),
                  })}
                </span>
              ) : null}
            </div>
          </Card>

          <section className="stack" aria-labelledby="dashboard-services-title">
            <h2 id="dashboard-services-title">{t("dashboard.services")}</h2>
            <div className="dashboard-services">
              {STATS_PROVIDERS.map((provider) => (
                <ServiceCard
                  key={provider}
                  provider={provider}
                  service={serviceByProvider.get(provider)}
                />
              ))}
            </div>
          </section>

          {data.limitations?.length ? (
            <Card>
              <h4>{t("dashboard.limitations")}</h4>
              <ul className="service-list">
                {data.limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ) : (
            <p className="muted small">{t("dashboard.noLimitations")}</p>
          )}

          {warnings.length ? (
            <Card>
              <h4>{t("dashboard.warnings")}</h4>
              <ul className="service-list">
                {warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={t("reports.confirm.title")}
        confirmLabel={t("reports.confirm.confirm")}
        cancelLabel={t("common.cancel")}
        busy={reports.loading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void buildWeekly();
        }}
      >
        <p>{t("reports.confirm.body")}</p>
      </ConfirmDialog>
    </section>
  );
});
