import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { Link, useNavigate } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useConfirmWorkspaceChange } from "@/app/providers/DiscardGuard";
import { ROUTES } from "@/app/routes";
import { useI18n } from "@/shared/i18n";
import { appErrorText, toAppError } from "@/shared/lib/errors";
import { formatDateTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { useFeedback } from "@/shared/ui/Feedback";
import { pickConfig } from "@/entities/engine/api/shell";
import { configMissing } from "@/entities/engine/model/types";
import { CoverageStrip } from "@/entities/stats/ui/CoverageStrip";
import { ServiceCard } from "@/entities/stats/ui/ServiceCard";
import { STATS_PROVIDERS } from "@/entities/stats/model/types";
import {
  activePeriod,
  sameWindowParams,
  useWindowSettings,
} from "@/entities/window";
import { RunStatus } from "@/shared/ui/RunStatus";
import { WindowPicker } from "@/shared/ui/WindowPicker";
import { PropertiesPanel } from "./PropertiesPanel";

export const DashboardPage = observer(function DashboardPage() {
  const { t, locale } = useI18n();
  const { engine, stats, reports, runs } = useRootStore();
  const confirmWorkspaceChange = useConfirmWorkspaceChange();
  const navigate = useNavigate();
  const { notify } = useFeedback();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Config path whose window was already applied automatically. A picker
  // change must not fire provider calls on every click; it only marks the
  // window as stale until the user refreshes.
  const appliedWindowPath = useRef<string | null>(null);
  const configPath = engine.status?.configPath ?? null;
  const windowSettings = useWindowSettings(configPath);
  const period = activePeriod(windowSettings.days, windowSettings.lagDays);
  const windowStale =
    stats.lastParams !== null &&
    !sameWindowParams(stats.lastParams, windowSettings.params);
  // A moved/deleted workspace must not look healthy: every stats/report call
  // would fail with a generic error instead of asking for the new path.
  const workspaceMissing = configMissing(engine.status);
  const blocked =
    engine.offline || engine.loading || !configPath || workspaceMissing;
  const activeRun = runs.activeFor("reportWeekly");

  useEffect(() => {
    // Without a workspace configuration `stats` is a guaranteed failure.
    if (
      engine.loading ||
      engine.offline ||
      !configPath ||
      workspaceMissing ||
      stats.loading ||
      appliedWindowPath.current === configPath
    ) {
      return;
    }
    // Apply the saved window once per workspace. `idle` means nothing loaded
    // yet; a different `lastParams` means bootstrap used the engine default
    // before this workspace's saved window was known.
    appliedWindowPath.current = configPath;
    if (
      stats.state === "idle" ||
      !sameWindowParams(stats.lastParams, windowSettings.params)
    ) {
      void stats.refresh(windowSettings.params);
    }
  }, [
    engine.loading,
    engine.offline,
    configPath,
    workspaceMissing,
    stats,
    stats.loading,
    stats.state,
    stats.lastParams,
    windowSettings,
    windowSettings.days,
    windowSettings.lagDays,
  ]);

  const reconnect = async () => {
    await engine.load();
    // Read the fresh status: the shell may have reported a config path.
    if (!engine.offline && engine.status?.configPath) {
      await stats.refresh(windowSettings.params);
    }
  };

  const chooseConfig = async () => {
    // The picker persists the new path before the page can react, so the
    // discard decision must happen before the dialog opens.
    if (!(await confirmWorkspaceChange())) {
      return;
    }
    try {
      const selected = await pickConfig();
      if (!selected) {
        return;
      }
      await engine.load();
      // The picker persists the path, but the shell can still fail to load it.
      if (engine.status?.configPath !== selected) {
        notify(t("settings.chooseConfigFailed"), "error");
        return;
      }
      notify(t("settings.configSelected"), "success");
      if (!configMissing(engine.status)) {
        await stats.refresh(windowSettings.params);
      }
    } catch (error) {
      notify(toAppError(error, "PICK_CONFIG").message, "error");
    }
  };

  const buildWeekly = async () => {
    if (blocked || reports.loading) {
      return;
    }
    const ok = await reports.buildWeekly(windowSettings.params);
    if (ok) {
      notify(t("reports.built"));
      navigate("/reports");
      return;
    }
    if (reports.state !== "cancelled") {
      notify(
        reports.error ? appErrorText(reports.error) : t("reports.buildFailed"),
        "error",
      );
    }
  };

  const requestBuild = () => {
    if (!blocked) {
      setConfirmOpen(true);
    }
  };

  const resetWindow = () => {
    windowSettings.reset();
    notify(t("window.resetDone"));
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
            onClick={() => void stats.refresh(windowSettings.params)}
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

      {workspaceMissing ? (
        <Notice
          variant="error"
          action={
            <Button variant="secondary" onClick={() => void chooseConfig()}>
              {t("settings.chooseConfig")}
            </Button>
          }
        >
          <strong>{t("dashboard.workspaceMissingTitle")}</strong>
          <span>{t("dashboard.workspaceMissingHint")}</span>
          {configPath ? (
            <code className="callback">
              {t("dashboard.workspaceMissingPath", { path: configPath })}
            </code>
          ) : null}
        </Notice>
      ) : null}

      <Card>
        <div className="card-header">
          <div>
            <h2>{t("window.title")}</h2>
            <p className="muted small">{t("window.hint")}</p>
          </div>
        </div>
        <WindowPicker
          days={windowSettings.days}
          lagDays={windowSettings.lagDays}
          period={period}
          disabled={engine.loading || !configPath || workspaceMissing}
          stale={windowStale}
          onDaysChange={(days) => windowSettings.setDays(days)}
          onLagChange={(lagDays) => windowSettings.setLagDays(lagDays)}
          onReset={resetWindow}
        />
      </Card>

      <RunStatus
        label={t("runStatus.statsLabel")}
        running={stats.loading}
        startedAt={stats.startedAt}
        lastRun={stats.lastRun}
      />
      <RunStatus
        label={t("runStatus.reportLabel")}
        running={reports.loading}
        startedAt={reports.startedAt}
        lastRun={reports.lastRun}
        cancelling={activeRun?.status === "cancelling"}
        onCancel={activeRun ? () => void runs.cancel(activeRun.id) : undefined}
      />

      {stats.error && !workspaceMissing ? (
        <Notice
          variant="error"
          action={
            <Button
              variant="secondary"
              onClick={() => void stats.refresh(windowSettings.params)}
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
              <div className="form-actions">
                <Link className="btn btn-primary" to={ROUTES.onboarding}>
                  {t("dashboard.createProject")}
                </Link>
                <Button variant="secondary" onClick={() => void chooseConfig()}>
                  {t("dashboard.chooseExisting")}
                </Button>
                <Link className="btn btn-secondary" to={ROUTES.settings}>
                  {t("dashboard.openSettings")}
                </Link>
              </div>
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
              <Button variant="primary" onClick={() => void stats.refresh(windowSettings.params)}>
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

      {configPath ? <PropertiesPanel /> : null}

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
