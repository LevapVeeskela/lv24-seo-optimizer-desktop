import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import {
  recommendationSourceLabel,
} from "@/entities/recommendation/model/copy";
import { useRecommendationCopy } from "@/entities/recommendation/model/useRecommendationCopy";
import {
  RECOMMENDATION_SEVERITIES,
  recommendationContext,
} from "@/entities/recommendation/model/types";
import { buildRecommendations } from "@/entities/recommendation/lib/buildRecommendations";
import { RecommendationCard } from "@/entities/recommendation/ui/RecommendationCard";
import { AgentTaskStore } from "@/features/agent-task/model/AgentTaskStore";
import { AgentQueue } from "@/features/agent-task/ui/AgentQueue";
import {
  copyRecommendationPrompt,
  exportRecommendationPrompt,
} from "@/features/agent-task/lib/actions";
import { useI18n } from "@/shared/i18n";
import { formatDateTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Field } from "@/shared/ui/Field";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { Select } from "@/shared/ui/Select";
import { useFeedback } from "@/shared/ui/Feedback";

export interface RecommendationsPageProps {
  /** Optional shared queue; the page owns a local store otherwise. */
  queueStore?: AgentTaskStore;
}

export const RecommendationsPage = observer(function RecommendationsPage({
  queueStore,
}: RecommendationsPageProps = {}) {
  const { locale } = useI18n();
  const copy = useRecommendationCopy();
  const { engine, reports, stats } = useRootStore();
  const { notify } = useFeedback();
  const [localQueue] = useState(() => new AgentTaskStore());
  const queue = queueStore ?? localQueue;
  const [sourceFilter, setSourceFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const configPath = engine.status?.configPath ?? null;

  useEffect(() => {
    // Without a workspace configuration `stats` is a guaranteed failure.
    if (!engine.loading && !engine.offline && configPath && stats.state === "idle") {
      void stats.refresh();
    }
  }, [engine.loading, engine.offline, configPath, stats]);

  const context = useMemo(
    () => recommendationContext(reports.report, stats.data),
    [reports.report, stats.data],
  );
  const recommendations = useMemo(
    () => buildRecommendations(reports.report, stats.data),
    [reports.report, stats.data],
  );

  const sources = useMemo(
    () =>
      [...new Set(recommendations.map((item) => item.source))].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    [recommendations],
  );
  const effectiveSource =
    sourceFilter === "all" || sources.includes(sourceFilter)
      ? sourceFilter
      : "all";
  const effectiveSeverity =
    severityFilter === "all" ||
    (RECOMMENDATION_SEVERITIES as readonly string[]).includes(severityFilter)
      ? severityFilter
      : "all";
  const filtered = recommendations.filter(
    (item) =>
      (effectiveSource === "all" || item.source === effectiveSource) &&
      (effectiveSeverity === "all" || item.severity === effectiveSeverity),
  );

  const buildWeekly = async () => {
    const ok = await reports.buildWeekly();
    notify(
      ok
        ? copy.reportBuilt
        : reports.error?.message ?? copy.reportError,
      ok ? "success" : "error",
    );
  };

  const requestBuild = () => setConfirmOpen(true);

  const reconnect = async () => {
    await engine.load();
    // Read the fresh status: the shell may have reported a config path.
    if (!engine.offline && engine.status?.configPath) {
      await stats.refresh();
    }
  };

  const copyPrompt = async (id: string) => {
    const recommendation = recommendations.find((item) => item.id === id);
    if (!recommendation) {
      return;
    }
    const ok = await copyRecommendationPrompt(
      recommendation,
      context.property,
      context.period,
    );
    if (ok) {
      queue.markCopied(id);
      notify(copy.copied);
    } else {
      notify(copy.copyFailed, "error");
    }
  };

  const addToQueue = (id: string) => {
    const recommendation = recommendations.find((item) => item.id === id);
    if (!recommendation || queue.has(id)) {
      return;
    }
    queue.add(recommendation, context.property, context.period);
    notify(copy.addedToQueue);
  };

  const exportTask = (id: string) => {
    const recommendation = recommendations.find((item) => item.id === id);
    if (!recommendation) {
      return;
    }
    const ok = exportRecommendationPrompt(
      recommendation,
      context.property,
      context.period,
    );
    if (ok) {
      queue.markExported(id);
      notify(copy.exported);
    } else {
      notify(copy.exportFailed, "error");
    }
  };

  const resetFilters = () => {
    setSourceFilter("all");
    setSeverityFilter("all");
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{copy.title}</h1>
          <p className="muted">{copy.subtitle}</p>
        </div>
        <div className="page-actions">
          <Button
            variant="secondary"
            loading={stats.loading}
            onClick={() => void stats.refresh()}
            disabled={engine.offline || !configPath}
          >
            {stats.loading ? copy.refreshing : copy.refreshStats}
          </Button>
          <Button
            variant="primary"
            loading={reports.loading}
            onClick={requestBuild}
            disabled={engine.offline || !configPath}
          >
            {reports.loading ? copy.building : copy.buildWeekly}
          </Button>
        </div>
      </header>

      {engine.offline ? (
        <Notice
          variant="info"
          action={
            <Button variant="secondary" onClick={() => void reconnect()}>
              {copy.retry}
            </Button>
          }
        >
          <strong>{copy.offlineTitle}</strong>
          <span>{copy.offlineHint}</span>
        </Notice>
      ) : null}

      {!configPath && !engine.loading && !engine.offline ? (
        <Notice
          variant="info"
          action={
            <Link className="btn btn-secondary" to="/settings">
              {copy.openSettings}
            </Link>
          }
        >
          <strong>{copy.noConfigTitle}</strong>
          <span>{copy.noConfigHint}</span>
        </Notice>
      ) : null}

      {reports.error ? (
        <Notice
          variant="error"
          action={
            <Button variant="secondary" onClick={requestBuild}>
              {copy.retry}
            </Button>
          }
        >
          <strong>{copy.reportError}</strong>
          <span>
            {reports.error.message}
            {reports.error.nextAction ? ` ${reports.error.nextAction}` : ""}
          </span>
        </Notice>
      ) : null}

      {stats.error ? (
        <Notice
          variant="error"
          action={
            <Button
              variant="secondary"
              onClick={() => void stats.refresh()}
              disabled={!configPath}
            >
              {copy.retry}
            </Button>
          }
        >
          <strong>{copy.statsError}</strong>
          <span>
            {stats.error.message}
            {stats.error.nextAction ? ` ${stats.error.nextAction}` : ""}
          </span>
        </Notice>
      ) : null}

      {reports.loading && !reports.report ? (
        <Loading label={copy.loading} />
      ) : null}

      {!reports.report &&
      !reports.loading &&
      recommendations.length === 0 ? (
        <Card>
          <EmptyState
            title={copy.reportMissingTitle}
            hint={copy.reportMissingHint}
            action={
              <Button
                variant="primary"
                loading={reports.loading}
                onClick={requestBuild}
                disabled={engine.offline || !configPath}
              >
                {reports.loading ? copy.building : copy.buildWeekly}
              </Button>
            }
          />
        </Card>
      ) : null}

      {reports.report ? (
        <Card className="report-summary">
          <div className="card-header">
            <div>
              <p className="eyebrow">{copy.title}</p>
              <h2>{reports.report.headline ?? copy.title}</h2>
            </div>
          </div>
          <div className="report-facts">
            {context.property ? (
              <span>
                {copy.property}: <code>{context.property}</code>
              </span>
            ) : null}
            {context.period ? (
              <span>
                {copy.period}: {context.period.start} – {context.period.end}
              </span>
            ) : null}
            {reports.report.generated_at ? (
              <span>
                {copy.generated.replace(
                  "{value}",
                  formatDateTime(reports.report.generated_at, locale),
                )}
              </span>
            ) : null}
          </div>
        </Card>
      ) : null}

      {recommendations.length > 0 ? (
        <Card>
          <div className="toolbar">
            <Field id="recommendation-source" label={copy.filters.source}>
              <Select
                id="recommendation-source"
                value={effectiveSource}
                onChange={(event) => setSourceFilter(event.target.value)}
              >
                <option value="all">{copy.filters.allSources}</option>
                {sources.map((source) => (
                  <option key={source} value={source}>
                    {recommendationSourceLabel(source)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="recommendation-severity" label={copy.filters.severity}>
              <Select
                id="recommendation-severity"
                value={effectiveSeverity}
                onChange={(event) => setSeverityFilter(event.target.value)}
              >
                <option value="all">{copy.filters.allSeverities}</option>
                {RECOMMENDATION_SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {copy.severity[severity]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
      ) : null}

      {reports.report && recommendations.length === 0 ? (
        <Card>
          <EmptyState
            title={copy.emptyTitle}
            hint={copy.emptyHint}
            action={
              <Button
                variant="secondary"
                loading={stats.loading}
                onClick={() => void stats.refresh()}
                disabled={engine.offline || !configPath}
              >
                {stats.loading ? copy.refreshing : copy.refreshStats}
              </Button>
            }
          />
        </Card>
      ) : null}

      {recommendations.length > 0 && filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={copy.filteredEmptyTitle}
            hint={copy.filteredEmptyHint}
            action={
              <Button variant="secondary" onClick={resetFilters}>
                {copy.resetFilters}
              </Button>
            }
          />
        </Card>
      ) : null}

      {filtered.length > 0 ? (
        <div className="dashboard-services">
          {filtered.map((recommendation) => (
            <RecommendationCard
              key={recommendation.id}
              recommendation={recommendation}
              inQueue={queue.has(recommendation.id)}
              onCopy={() => void copyPrompt(recommendation.id)}
              onAdd={() => addToQueue(recommendation.id)}
              onExport={() => exportTask(recommendation.id)}
            />
          ))}
        </div>
      ) : null}

      <AgentQueue store={queue} />

      <ConfirmDialog
        open={confirmOpen}
        title={copy.confirmTitle}
        confirmLabel={copy.confirmConfirm}
        cancelLabel={copy.cancel}
        busy={reports.loading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void buildWeekly();
        }}
      >
        <p>{copy.confirmBody}</p>
      </ConfirmDialog>
    </section>
  );
});
