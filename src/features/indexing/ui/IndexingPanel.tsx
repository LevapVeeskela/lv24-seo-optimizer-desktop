import { useEffect, useState, type ReactNode } from "react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n, type MessageKey } from "@/shared/i18n";
import { appErrorText, type AppError } from "@/shared/lib/errors";
import { formatDateTime, formatNumber } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { InlineError } from "@/shared/ui/InlineError";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { Table } from "@/shared/ui/Table";
import { Textarea } from "@/shared/ui/Textarea";
import {
  indexingErrorHint,
  type BingIssueRow,
  type BingQuotaReport,
  type BingSubmitCounts,
  type IndexingDetail,
  type IndexingOutcome,
  type IndexingOutcomeStatus,
  type IndexingPlan,
} from "../model/types";
import "./indexing.css";

const STATUS_KEYS: Record<IndexingOutcomeStatus, MessageKey> = {
  applied: "indexing.status.applied",
  skipped: "indexing.status.skipped",
  unknown: "indexing.status.unknown",
};

function DetailTable({
  caption,
  details,
}: {
  caption: string;
  details: IndexingDetail[];
}) {
  const { t } = useI18n();
  return (
    <Table caption={caption} className="indexing-details">
      <thead>
        <tr>
          <th scope="col">{t("indexing.plan.detailKey")}</th>
          <th scope="col">{t("indexing.plan.detailValue")}</th>
        </tr>
      </thead>
      <tbody>
        {details.map((detail) => (
          <tr key={detail.key}>
            <td>
              <code>{detail.key}</code>
            </td>
            <td>{detail.value}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function IndexingPlanCard({
  title,
  plan,
  showDetails = true,
}: {
  title: string;
  plan: IndexingPlan;
  showDetails?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="stack indexing-plan">
      <div className="card-header">
        <h4>{title}</h4>
        {plan.status ? <Badge tone="info">{plan.status}</Badge> : null}
      </div>

      {plan.summary ? <p>{plan.summary}</p> : null}

      <div className="indexing-facts">
        {plan.action ? (
          <div className="indexing-fact">
            <span className="muted small">{t("indexing.plan.action")}</span>
            <strong>{plan.action}</strong>
          </div>
        ) : null}
        {plan.target ? (
          <div className="indexing-fact">
            <span className="muted small">{t("indexing.plan.target")}</span>
            <code>{plan.target}</code>
          </div>
        ) : null}
        {plan.planHash ? (
          <div className="indexing-fact">
            <span className="muted small">{t("indexing.plan.planHash")}</span>
            <code>{plan.planHash}</code>
          </div>
        ) : null}
      </div>

      {showDetails && plan.details.length ? (
        <>
          <h4>{t("indexing.plan.payload")}</h4>
          <DetailTable caption={t("indexing.plan.payload")} details={plan.details} />
        </>
      ) : null}

      {plan.ttlSeconds ? (
        <p className="muted small">
          {t("indexing.plan.ttl", { seconds: plan.ttlSeconds })}
        </p>
      ) : null}

      {!plan.confirmToken ? (
        <Notice variant="info">
          <span>{t("indexing.plan.tokenMissing")}</span>
        </Notice>
      ) : null}

      {plan.limitations.length ? (
        <div>
          <h4>{t("indexing.plan.limitations")}</h4>
          <ul className="report-notes">
            {plan.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function IndexingOutcomeCard({
  title,
  outcome,
  counting = false,
  showDetails = true,
  appliedLabel,
}: {
  title: string;
  outcome: IndexingOutcome;
  counting?: boolean;
  showDetails?: boolean;
  appliedLabel?: MessageKey;
}) {
  const { t, locale } = useI18n();
  const tone =
    outcome.status === "applied"
      ? "success"
      : outcome.status === "skipped"
        ? "warning"
        : "neutral";
  const badgeKey =
    outcome.status === "applied" && appliedLabel
      ? appliedLabel
      : STATUS_KEYS[outcome.status];
  return (
    <div className="stack indexing-outcome">
      <div className="card-header">
        <h4>{title}</h4>
        <Badge tone={tone}>{t(badgeKey)}</Badge>
      </div>

      <div className="indexing-facts">
        {outcome.plan?.target ? (
          <div className="indexing-fact">
            <span className="muted small">{t("indexing.plan.target")}</span>
            <code>{outcome.plan.target}</code>
          </div>
        ) : null}
        {outcome.reason ? (
          <div className="indexing-fact">
            <span className="muted small">{t("indexing.plan.reason")}</span>
            <strong>{outcome.reason}</strong>
          </div>
        ) : null}
        {counting ? (
          <div className="indexing-fact">
            <span className="muted small">{t("indexing.indexnow.resultTitle")}</span>
            <strong>
              {outcome.submitted === null
                ? t("indexing.indexnow.countUnknown")
                : t("indexing.indexnow.submitted", {
                    count: formatNumber(outcome.submitted, locale),
                  })}
            </strong>
          </div>
        ) : null}
      </div>

      {showDetails && outcome.details.length ? (
        <>
          <h4>{t("indexing.plan.details")}</h4>
          <DetailTable
            caption={t("indexing.plan.details")}
            details={outcome.details}
          />
        </>
      ) : null}
    </div>
  );
}

function IndexingErrorNotice({
  title,
  error,
  action,
}: {
  title: string;
  error: AppError;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  const hint = indexingErrorHint(error);
  return (
    <Notice variant="error" action={action}>
      <strong>{title}</strong>
      <span>{appErrorText(error)}</span>
      <code className="callback">
        {t("integrations.errorCode", { code: error.code })}
      </code>
      {hint === "auth" ? (
        <span>
          {t("indexing.requiresKey")}{" "}
          <Link to="/settings">{t("indexing.openSettings")}</Link>
        </span>
      ) : null}
      {hint === "engine" ? <span>{t("indexing.engineHint")}</span> : null}
    </Notice>
  );
}

function Warnings({ items }: { items: string[] }) {
  const { t } = useI18n();
  const warnings = [...new Set(items.filter((item) => item.trim() !== ""))];
  if (!warnings.length) {
    return null;
  }
  return (
    <div>
      <h4>{t("indexing.warnings")}</h4>
      <ul className="report-notes">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

function Limitations({ items }: { items: string[] }) {
  const { t } = useI18n();
  const limitations = [...new Set(items.filter((item) => item.trim() !== ""))];
  if (!limitations.length) {
    return null;
  }
  return (
    <div>
      <h4>{t("indexing.readOnly.limitations")}</h4>
      <ul className="report-notes">
        {limitations.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="indexing-fact">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * `GetUrlSubmissionQuota` returns remaining counts. Daily and monthly are
 * shown separately and never converted to a "used" or "total" number.
 */
function QuotaFacts({
  title,
  report,
}: {
  title?: string;
  report: BingQuotaReport;
}) {
  const { t, locale } = useI18n();
  const remaining = (value: number | null): string =>
    value === null ? t("indexing.quota.unknown") : formatNumber(value, locale);
  return (
    <div className="stack">
      {title ? <h4>{title}</h4> : null}
      <div className="indexing-facts">
        <Fact
          label={t("indexing.quota.daily")}
          value={remaining(report.dailyRemaining)}
        />
        <Fact
          label={t("indexing.quota.monthly")}
          value={remaining(report.monthlyRemaining)}
        />
      </div>
      <p className="muted small">{t("indexing.quota.limitHint")}</p>
    </div>
  );
}

function BingSubmitCountsCard({
  title,
  counts,
  phase,
  applied = true,
}: {
  title: string;
  counts: BingSubmitCounts | null;
  phase: "plan" | "result";
  applied?: boolean;
}) {
  const { t, locale } = useI18n();
  if (!counts) {
    return null;
  }
  const numberText = (value: number | null): string =>
    value === null
      ? t("indexing.bing.countUnknown")
      : formatNumber(value, locale);
  return (
    <div className="stack">
      <h4>{title}</h4>
      <div className="indexing-facts">
        {phase === "plan" ? (
          <Fact
            label={t("indexing.bing.planUrls")}
            value={numberText(counts.urls)}
          />
        ) : (
          <Fact
            label={t("indexing.bing.acceptedLabel")}
            value={
              counts.accepted === null
                ? t("indexing.bing.acceptedUnknown")
                : t("indexing.bing.accepted", {
                    count: formatNumber(counts.accepted, locale),
                  })
            }
          />
        )}
        <Fact
          label={t("indexing.bing.planBatches")}
          value={numberText(counts.batches)}
        />
      </div>
      {phase === "result" && applied && counts.accepted !== null ? (
        <p className="muted small">{t("indexing.bing.acceptedNote")}</p>
      ) : null}
      <QuotaFacts
        title={
          phase === "plan"
            ? t("indexing.bing.quotaCurrent")
            : t("indexing.bing.quotaAfter")
        }
        report={counts.quota}
      />
    </div>
  );
}

const BING_ISSUE_FLAGS: Array<[number, MessageKey]> = [
  [1, "indexing.issues.flag.301"],
  [2, "indexing.issues.flag.302"],
  [4, "indexing.issues.flag.4xx"],
  [8, "indexing.issues.flag.5xx"],
  [16, "indexing.issues.flag.robots"],
  [32, "indexing.issues.flag.malware"],
  [64, "indexing.issues.flag.importantRobots"],
  [128, "indexing.issues.flag.dns"],
  [256, "indexing.issues.flag.timeout"],
];

/** Decode the `GetCrawlIssues` bitmask; unknown bits stay visible. */
function BingIssueLabels({ mask }: { mask: number | null }) {
  const { t } = useI18n();
  if (mask === null) {
    return <>{t("common.notAvailable")}</>;
  }
  if (mask === 0) {
    return <>{t("indexing.issues.noFlags")}</>;
  }
  const labels = BING_ISSUE_FLAGS.filter(
    ([bit]) => (mask & bit) !== 0,
  ).map(([, key]) => t(key));
  const known = BING_ISSUE_FLAGS.reduce((total, [bit]) => total | bit, 0);
  const unknown = mask & ~known;
  if (unknown) {
    labels.push(t("indexing.issues.unknownFlag", { bit: unknown }));
  }
  return <>{labels.join(", ")}</>;
}

/**
 * Bing indexing actions: two-phase sitemap submit and IndexNow-from-sitemap,
 * plus an opener for the official Site Scan page. Bing has no public API for
 * starting a Site Scan, so the last action never claims to start one.
 */
export const IndexingPanel = observer(function IndexingPanel() {
  const { t, locale } = useI18n();
  const { engine, indexing: store } = useRootStore();
  const [sitemapConfirmOpen, setSitemapConfirmOpen] = useState(false);
  const [indexNowConfirmOpen, setIndexNowConfirmOpen] = useState(false);
  const [bingConfirmOpen, setBingConfirmOpen] = useState(false);

  useEffect(
    () => () => {
      // Leaving the page must not leave a confirmation armed.
      store.cancelSitemapApply();
      store.cancelIndexNowApply();
      store.cancelBingApply();
    },
    [store],
  );

  const configPath = engine.status?.configPath ?? null;
  const blocked = engine.offline || engine.loading || !configPath;

  // Read-only status views load once per workspace and can be refreshed.
  useEffect(() => {
    if (!configPath || engine.offline || engine.loading) {
      return;
    }
    void store.loadBingSitemaps(configPath);
    void store.loadBingIssues(configPath);
    void store.loadBingQuota(configPath);
  }, [configPath, engine.offline, engine.loading, store]);

  const sitemapBusy = store.sitemapPlanning || store.sitemapApplying;
  const indexNowBusy = store.indexNowPlanning || store.indexNowApplying;
  const bingBusy = store.bingPlanning || store.bingApplying;
  const sitemapValue = store.sitemapRequestUrl;
  const sitemapError = store.sitemapUrlInvalid
    ? t("indexing.sitemap.urlInvalid")
    : undefined;
  const bingUrlInvalid = store.bingInvalidUrls.length > 0;
  const bingUrlError = bingUrlInvalid
    ? t("indexing.bing.urlsInvalid", {
        count: store.bingInvalidUrls.length,
      })
    : undefined;
  const bingSourceSummary = store.bingFromSitemap
    ? store.bingUrls.length
      ? t("indexing.bing.sourceMixed", { count: store.bingUrls.length })
      : t("indexing.bing.sourceSitemap")
    : store.bingUrls.length
      ? t("indexing.bing.sourceUrls", { count: store.bingUrls.length })
      : t("indexing.bing.noSource");
  const siteUrlInvalid =
    store.siteUrl.trim() !== "" && !store.siteUrlValid;
  const sitemapPlan = store.sitemapPlan;
  const indexNowPlan = store.indexNowPlan;
  const bingPlan = store.bingPlan;
  const sitemapsReport = store.sitemapsReport;
  const issuesReport = store.issuesReport;
  const quotaReport = store.quotaReport;
  const defaultSitemap = t("indexing.defaultSitemap");

  const planBing = () => {
    if (
      blocked ||
      bingBusy ||
      !store.bingCanPlan ||
      (store.bingFromSitemap && store.sitemapUrlInvalid)
    ) {
      return;
    }
    void store.planBing(configPath);
  };

  const requestBingApply = () => {
    if (blocked || store.bingApplying) {
      return;
    }
    if (store.requestBingApply()) {
      setBingConfirmOpen(true);
    }
  };

  const planSitemap = () => {
    if (blocked || sitemapBusy || store.sitemapUrlInvalid) {
      return;
    }
    void store.planSitemap(configPath);
  };

  const requestSitemapApply = () => {
    if (blocked || store.sitemapApplying) {
      return;
    }
    if (store.requestSitemapApply()) {
      setSitemapConfirmOpen(true);
    }
  };

  const planIndexNow = () => {
    if (blocked || indexNowBusy || store.sitemapUrlInvalid) {
      return;
    }
    void store.planIndexNow(configPath);
  };

  const requestIndexNowApply = () => {
    if (blocked || store.indexNowApplying) {
      return;
    }
    if (store.requestIndexNowApply()) {
      setIndexNowConfirmOpen(true);
    }
  };

  return (
    <Card>
      <div className="card-header">
        <div>
          <h2>{t("indexing.title")}</h2>
          <p className="muted small">{t("indexing.subtitle")}</p>
        </div>
        <Badge tone="warning">{t("indexing.badge")}</Badge>
      </div>

      {engine.offline ? (
        <Notice
          variant="info"
          action={
            <Button variant="secondary" onClick={() => void engine.load()}>
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("indexing.offlineTitle")}</strong>
          <span>{t("indexing.offlineHint")}</span>
        </Notice>
      ) : null}

      {!configPath && !engine.loading && !engine.offline ? (
        <Notice
          variant="info"
          action={
            <Link className="btn btn-secondary" to="/settings">
              {t("indexing.openSettings")}
            </Link>
          }
        >
          <strong>{t("indexing.noWorkspaceTitle")}</strong>
          <span>{t("indexing.noWorkspaceHint")}</span>
        </Notice>
      ) : null}

      <section
        className="indexing-section"
        aria-labelledby="indexing-bing-title"
      >
        <div className="card-header">
          <div>
            <h3 id="indexing-bing-title">{t("indexing.bing.title")}</h3>
            <p className="muted small">{t("indexing.bing.hint")}</p>
          </div>
          <Badge tone="info">{t("indexing.twoPhaseBadge")}</Badge>
        </div>

        <div className="form-grid indexing-form">
          <Field
            id="indexing-bing-urls"
            label={t("indexing.bing.urlsLabel")}
            hint={t("indexing.bing.urlsHint")}
            error={bingUrlError}
          >
            <Textarea
              id="indexing-bing-urls"
              className="indexing-urls"
              value={store.bingUrlInput}
              rows={5}
              spellCheck={false}
              autoComplete="off"
              disabled={bingBusy}
              placeholder={t("indexing.bing.urlsPlaceholder")}
              aria-invalid={bingUrlInvalid}
              aria-describedby={
                bingUrlError
                  ? "indexing-bing-urls-hint indexing-bing-urls-error"
                  : "indexing-bing-urls-hint"
              }
              onChange={(event) => store.setBingUrls(event.target.value)}
            />
          </Field>
        </div>

        <label className="indexing-check" htmlFor="indexing-bing-from-sitemap">
          <input
            id="indexing-bing-from-sitemap"
            type="checkbox"
            checked={store.bingFromSitemap}
            disabled={bingBusy}
            onChange={(event) =>
              store.setBingFromSitemap(event.target.checked)
            }
          />
          <span>
            <strong>{t("indexing.bing.fromSitemap")}</strong>
            <small className="muted">
              {t("indexing.bing.fromSitemapHint")}
            </small>
          </span>
        </label>

        {store.bingFromSitemap && store.sitemapUrlInvalid ? (
          <InlineError>{t("indexing.sitemap.urlInvalid")}</InlineError>
        ) : null}

        <p className="muted small indexing-limit">{bingSourceSummary}</p>
        <p className="muted small">{t("indexing.bing.engineErrorHint")}</p>

        <div className="form-actions">
          <Button
            variant="secondary"
            loading={store.bingPlanning}
            disabled={
              blocked ||
              bingBusy ||
              !store.bingCanPlan ||
              (store.bingFromSitemap && store.sitemapUrlInvalid)
            }
            onClick={planBing}
          >
            {store.bingPlanning
              ? t("indexing.bing.reviewing")
              : t("indexing.bing.review")}
          </Button>
          <Button
            variant="danger"
            loading={store.bingApplying}
            disabled={blocked || !store.bingReady || bingBusy}
            onClick={requestBingApply}
          >
            {store.bingApplying
              ? t("indexing.bing.applying")
              : t("indexing.bing.apply")}
          </Button>
        </div>

        {store.bingError ? (
          <IndexingErrorNotice
            title={t("indexing.bing.errorTitle")}
            error={store.bingError}
            action={
              <Button
                variant="secondary"
                disabled={blocked || bingBusy || !store.bingCanPlan}
                onClick={planBing}
              >
                {t("common.retry")}
              </Button>
            }
          />
        ) : null}

        {store.bingPlanning ? (
          <Loading label={t("indexing.bing.reviewing")} />
        ) : null}

        {store.bingState === "cancelled" ? (
          <Notice variant="info">
            <strong>{t("runStatus.cancelled")}</strong>
            <span>{t("indexing.bing.cancelled")}</span>
          </Notice>
        ) : null}

        {!bingPlan &&
        store.bingState === "idle" &&
        !store.bingError &&
        !blocked ? (
          <EmptyState
            title={t("indexing.bing.emptyTitle")}
            hint={t("indexing.bing.emptyHint")}
          />
        ) : null}

        {bingPlan ? (
          <>
            <IndexingPlanCard
              title={t("indexing.bing.planTitle")}
              plan={bingPlan}
              showDetails={false}
            />
            <BingSubmitCountsCard
              title={t("indexing.bing.planCounts")}
              counts={store.bingPlanCounts}
              phase="plan"
            />
          </>
        ) : null}

        {store.bingApplying ? (
          <Loading label={t("indexing.bing.applying")} />
        ) : null}

        {store.bingOutcome ? (
          <>
            <IndexingOutcomeCard
              title={t("indexing.bing.resultTitle")}
              outcome={store.bingOutcome}
              showDetails={false}
              appliedLabel="indexing.status.accepted"
            />
            <BingSubmitCountsCard
              title={t("indexing.bing.resultCounts")}
              counts={store.bingOutcomeCounts}
              phase="result"
              applied={store.bingOutcome?.status === "applied"}
            />
          </>
        ) : null}

        <Warnings items={store.bingWarnings} />

        <ConfirmDialog
          open={bingConfirmOpen}
          title={t("indexing.bing.confirmTitle")}
          confirmLabel={t("indexing.bing.confirmAction")}
          cancelLabel={t("common.cancel")}
          danger
          busy={store.bingApplying}
          onCancel={() => {
            setBingConfirmOpen(false);
            store.cancelBingApply();
          }}
          onConfirm={() => {
            setBingConfirmOpen(false);
            void store.confirmBing(configPath);
          }}
        >
          <p>
            {t(
              store.bingFromSitemap && store.bingUrls.length
                ? "indexing.bing.confirmBodyMixed"
                : store.bingFromSitemap
                  ? "indexing.bing.confirmBodySitemap"
                  : "indexing.bing.confirmBody",
              {
                count: store.bingUrls.length,
                sitemap: sitemapValue ?? defaultSitemap,
                seconds: bingPlan?.ttlSeconds ?? 300,
              },
            )}
          </p>
        </ConfirmDialog>
      </section>

      <section className="indexing-section" aria-labelledby="indexing-sitemap-title">
        <div className="card-header">
          <div>
            <h3 id="indexing-sitemap-title">{t("indexing.sitemap.title")}</h3>
            <p className="muted small">{t("indexing.sitemap.hint")}</p>
          </div>
          <Badge tone="info">{t("indexing.twoPhaseBadge")}</Badge>
        </div>

        <div className="form-grid indexing-form">
          <Field
            id="indexing-sitemap-url"
            label={t("indexing.sitemap.urlLabel")}
            hint={t("indexing.sitemap.urlHint")}
            error={sitemapError}
          >
            <Input
              id="indexing-sitemap-url"
              value={store.sitemapUrl}
              spellCheck={false}
              autoComplete="off"
              disabled={sitemapBusy || indexNowBusy}
              placeholder={t("indexing.sitemap.urlPlaceholder")}
              aria-invalid={store.sitemapUrlInvalid}
              aria-describedby={
                sitemapError
                  ? "indexing-sitemap-url-hint indexing-sitemap-url-error"
                  : "indexing-sitemap-url-hint"
              }
              onChange={(event) => store.setSitemapUrl(event.target.value)}
            />
          </Field>
        </div>

        <p className="muted small">{t("indexing.sharedSitemapHint")}</p>

        <div className="form-actions">
          <Button
            variant="secondary"
            loading={store.sitemapPlanning}
            disabled={
              blocked || sitemapBusy || indexNowBusy || store.sitemapUrlInvalid
            }
            onClick={planSitemap}
          >
            {store.sitemapPlanning
              ? t("indexing.sitemap.reviewing")
              : t("indexing.sitemap.review")}
          </Button>
          <Button
            variant="danger"
            loading={store.sitemapApplying}
            disabled={blocked || !store.sitemapReady || sitemapBusy}
            onClick={requestSitemapApply}
          >
            {store.sitemapApplying
              ? t("indexing.sitemap.applying")
              : t("indexing.sitemap.apply")}
          </Button>
        </div>

        {store.sitemapError ? (
          <IndexingErrorNotice
            title={t("indexing.sitemap.errorTitle")}
            error={store.sitemapError}
            action={
              <Button
                variant="secondary"
                disabled={blocked || sitemapBusy || store.sitemapUrlInvalid}
                onClick={planSitemap}
              >
                {t("common.retry")}
              </Button>
            }
          />
        ) : null}

        {store.sitemapPlanning ? (
          <Loading label={t("indexing.sitemap.reviewing")} />
        ) : null}

        {store.sitemapState === "cancelled" ? (
          <Notice variant="info">
            <strong>{t("runStatus.cancelled")}</strong>
            <span>{t("indexing.sitemap.cancelled")}</span>
          </Notice>
        ) : null}

        {!sitemapPlan &&
        store.sitemapState === "idle" &&
        !store.sitemapError &&
        !blocked ? (
          <EmptyState
            title={t("indexing.sitemap.emptyTitle")}
            hint={t("indexing.sitemap.emptyHint")}
          />
        ) : null}

        {sitemapPlan ? (
          <IndexingPlanCard
            title={t("indexing.sitemap.planTitle")}
            plan={sitemapPlan}
          />
        ) : null}

        {store.sitemapApplying ? (
          <Loading label={t("indexing.sitemap.applying")} />
        ) : null}

        {store.sitemapOutcome ? (
          <IndexingOutcomeCard
            title={t("indexing.sitemap.resultTitle")}
            outcome={store.sitemapOutcome}
          />
        ) : null}

        <Warnings items={store.sitemapWarnings} />

        <ConfirmDialog
          open={sitemapConfirmOpen}
          title={t("indexing.sitemap.confirmTitle")}
          confirmLabel={t("indexing.sitemap.confirmAction")}
          cancelLabel={t("common.cancel")}
          danger
          busy={store.sitemapApplying}
          onCancel={() => {
            setSitemapConfirmOpen(false);
            store.cancelSitemapApply();
          }}
          onConfirm={() => {
            setSitemapConfirmOpen(false);
            void store.confirmSitemap(configPath);
          }}
        >
          <p>
            {t("indexing.sitemap.confirmBody", {
              target: sitemapPlan?.target ?? sitemapValue ?? defaultSitemap,
              seconds: sitemapPlan?.ttlSeconds ?? 300,
            })}
          </p>
          {sitemapValue ? (
            <p>
              <code>{sitemapValue}</code>
            </p>
          ) : (
            <p>{t("indexing.defaultSitemap")}</p>
          )}
        </ConfirmDialog>
      </section>

      <section
        className="indexing-section"
        aria-labelledby="indexing-indexnow-title"
      >
        <div className="card-header">
          <div>
            <h3 id="indexing-indexnow-title">{t("indexing.indexnow.title")}</h3>
            <p className="muted small">{t("indexing.indexnow.hint")}</p>
          </div>
          <Badge tone="info">{t("indexing.twoPhaseBadge")}</Badge>
        </div>

        <div className="form-actions">
          <Button
            variant="secondary"
            loading={store.indexNowPlanning}
            disabled={
              blocked || sitemapBusy || indexNowBusy || store.sitemapUrlInvalid
            }
            onClick={planIndexNow}
          >
            {store.indexNowPlanning
              ? t("indexing.indexnow.reviewing")
              : t("indexing.indexnow.review")}
          </Button>
          <Button
            variant="danger"
            loading={store.indexNowApplying}
            disabled={blocked || !store.indexNowReady || indexNowBusy}
            onClick={requestIndexNowApply}
          >
            {store.indexNowApplying
              ? t("indexing.indexnow.applying")
              : t("indexing.indexnow.apply")}
          </Button>
        </div>

        {store.indexNowError ? (
          <IndexingErrorNotice
            title={t("indexing.indexnow.errorTitle")}
            error={store.indexNowError}
            action={
              <Button
                variant="secondary"
                disabled={blocked || indexNowBusy || store.sitemapUrlInvalid}
                onClick={planIndexNow}
              >
                {t("common.retry")}
              </Button>
            }
          />
        ) : null}

        {store.indexNowPlanning ? (
          <Loading label={t("indexing.indexnow.reviewing")} />
        ) : null}

        {store.indexNowState === "cancelled" ? (
          <Notice variant="info">
            <strong>{t("runStatus.cancelled")}</strong>
            <span>{t("indexing.indexnow.cancelled")}</span>
          </Notice>
        ) : null}

        {!indexNowPlan &&
        store.indexNowState === "idle" &&
        !store.indexNowError &&
        !blocked ? (
          <EmptyState
            title={t("indexing.indexnow.emptyTitle")}
            hint={t("indexing.indexnow.emptyHint")}
          />
        ) : null}

        {indexNowPlan ? (
          <IndexingPlanCard
            title={t("indexing.indexnow.planTitle")}
            plan={indexNowPlan}
          />
        ) : null}

        {store.indexNowApplying ? (
          <Loading label={t("indexing.indexnow.applying")} />
        ) : null}

        {store.indexNowOutcome ? (
          <IndexingOutcomeCard
            title={t("indexing.indexnow.resultTitle")}
            outcome={store.indexNowOutcome}
            counting
          />
        ) : null}

        <Warnings items={store.indexNowWarnings} />

        <ConfirmDialog
          open={indexNowConfirmOpen}
          title={t("indexing.indexnow.confirmTitle")}
          confirmLabel={t("indexing.indexnow.confirmAction")}
          cancelLabel={t("common.cancel")}
          danger
          busy={store.indexNowApplying}
          onCancel={() => {
            setIndexNowConfirmOpen(false);
            store.cancelIndexNowApply();
          }}
          onConfirm={() => {
            setIndexNowConfirmOpen(false);
            void store.confirmIndexNow(configPath);
          }}
        >
          <p>
            {t("indexing.indexnow.confirmBody", {
              sitemap: sitemapValue ?? defaultSitemap,
              seconds: indexNowPlan?.ttlSeconds ?? 300,
            })}
          </p>
        </ConfirmDialog>
      </section>

      <section
        className="indexing-section"
        aria-labelledby="indexing-sitemaps-title"
      >
        <div className="card-header">
          <div>
            <h3 id="indexing-sitemaps-title">
              {t("indexing.sitemaps.title")}
            </h3>
            <p className="muted small">{t("indexing.sitemaps.hint")}</p>
          </div>
          <div className="form-actions">
            <Badge tone="neutral">{t("indexing.readOnly.badge")}</Badge>
            <Button
              variant="secondary"
              loading={store.sitemapsLoading}
              disabled={blocked || store.sitemapsLoading}
              onClick={() => void store.loadBingSitemaps(configPath)}
            >
              {store.sitemapsLoading
                ? t("indexing.sitemaps.refreshing")
                : t("indexing.sitemaps.refresh")}
            </Button>
          </div>
        </div>

        {store.sitemapsError ? (
          <IndexingErrorNotice
            title={t("indexing.sitemaps.errorTitle")}
            error={store.sitemapsError}
            action={
              <Button
                variant="secondary"
                disabled={blocked || store.sitemapsLoading}
                onClick={() => void store.loadBingSitemaps(configPath)}
              >
                {t("common.retry")}
              </Button>
            }
          />
        ) : null}

        {store.sitemapsLoading ? (
          <Loading label={t("indexing.sitemaps.refreshing")} />
        ) : null}

        {!store.sitemapsLoading &&
        sitemapsReport &&
        sitemapsReport.rows.length ? (
          <Table caption={t("indexing.sitemaps.title")}>
            <thead>
              <tr>
                <th scope="col">{t("indexing.sitemaps.columnUrl")}</th>
                <th scope="col">{t("indexing.sitemaps.columnStatus")}</th>
                <th scope="col">
                  {t("indexing.sitemaps.columnLastCrawled")}
                </th>
                <th scope="col">{t("indexing.sitemaps.columnUrlCount")}</th>
              </tr>
            </thead>
            <tbody>
              {sitemapsReport.rows.map((row, index) => (
                <tr key={`${row.url}-${index}`}>
                  <td>
                    <code>{row.url || t("common.notAvailable")}</code>
                  </td>
                  <td>{row.status ?? t("common.notAvailable")}</td>
                  <td>
                    {row.lastCrawled
                      ? formatDateTime(row.lastCrawled, locale)
                      : t("common.notAvailable")}
                  </td>
                  <td>{formatNumber(row.urlCount, locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {!store.sitemapsLoading &&
        sitemapsReport &&
        !sitemapsReport.rows.length ? (
          <EmptyState
            title={t("indexing.sitemaps.emptyTitle")}
            hint={t("indexing.sitemaps.emptyHint")}
          />
        ) : null}

        {!store.sitemapsLoading &&
        !sitemapsReport &&
        !store.sitemapsError &&
        !blocked ? (
          <EmptyState
            title={t("indexing.sitemaps.emptyTitle")}
            hint={t("indexing.sitemaps.emptyHint")}
          />
        ) : null}

        <Notice variant="info">
          <span>{t("indexing.sitemaps.limitation")}</span>
        </Notice>
        <p className="muted small">{t("indexing.sitemaps.indexNote")}</p>
        <Warnings items={store.sitemapsWarnings} />
        <Limitations items={sitemapsReport?.limitations ?? []} />
      </section>

      <section
        className="indexing-section"
        aria-labelledby="indexing-issues-title"
      >
        <div className="card-header">
          <div>
            <h3 id="indexing-issues-title">{t("indexing.issues.title")}</h3>
            <p className="muted small">{t("indexing.issues.hint")}</p>
          </div>
          <div className="form-actions">
            <Badge tone="neutral">{t("indexing.readOnly.badge")}</Badge>
            <Button
              variant="secondary"
              loading={store.issuesLoading}
              disabled={blocked || store.issuesLoading}
              onClick={() => void store.loadBingIssues(configPath)}
            >
              {store.issuesLoading
                ? t("indexing.issues.refreshing")
                : t("indexing.issues.refresh")}
            </Button>
          </div>
        </div>

        {store.issuesError ? (
          <IndexingErrorNotice
            title={t("indexing.issues.errorTitle")}
            error={store.issuesError}
            action={
              <Button
                variant="secondary"
                disabled={blocked || store.issuesLoading}
                onClick={() => void store.loadBingIssues(configPath)}
              >
                {t("common.retry")}
              </Button>
            }
          />
        ) : null}

        {store.issuesLoading ? (
          <Loading label={t("indexing.issues.refreshing")} />
        ) : null}

        {!store.issuesLoading && issuesReport && issuesReport.rows.length ? (
          <Table caption={t("indexing.issues.title")}>
            <thead>
              <tr>
                <th scope="col">{t("indexing.issues.columnUrl")}</th>
                <th scope="col">{t("indexing.issues.columnHttp")}</th>
                <th scope="col">{t("indexing.issues.columnIssues")}</th>
                <th scope="col">{t("indexing.issues.columnInLinks")}</th>
              </tr>
            </thead>
            <tbody>
              {issuesReport.rows.map((row: BingIssueRow, index) => (
                <tr key={`${row.url}-${index}`}>
                  <td>
                    <code>{row.url || t("common.notAvailable")}</code>
                  </td>
                  <td>{formatNumber(row.httpCode, locale)}</td>
                  <td>
                    <BingIssueLabels mask={row.issues} />
                  </td>
                  <td>{formatNumber(row.inLinks, locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {!store.issuesLoading && issuesReport && !issuesReport.rows.length ? (
          <EmptyState
            title={t("indexing.issues.emptyTitle")}
            hint={t("indexing.issues.emptyHint")}
          />
        ) : null}

        {!store.issuesLoading &&
        !issuesReport &&
        !store.issuesError &&
        !blocked ? (
          <EmptyState
            title={t("indexing.issues.emptyTitle")}
            hint={t("indexing.issues.emptyHint")}
          />
        ) : null}

        <p className="muted small">{t("indexing.issues.maskHint")}</p>
        <Warnings items={store.issuesWarnings} />
        <Limitations items={issuesReport?.limitations ?? []} />
      </section>

      <section
        className="indexing-section"
        aria-labelledby="indexing-quota-title"
      >
        <div className="card-header">
          <div>
            <h3 id="indexing-quota-title">{t("indexing.quota.title")}</h3>
            <p className="muted small">{t("indexing.quota.hint")}</p>
          </div>
          <div className="form-actions">
            <Badge tone="neutral">{t("indexing.readOnly.badge")}</Badge>
            <Button
              variant="secondary"
              loading={store.quotaLoading}
              disabled={blocked || store.quotaLoading}
              onClick={() => void store.loadBingQuota(configPath)}
            >
              {store.quotaLoading
                ? t("indexing.quota.refreshing")
                : t("indexing.quota.refresh")}
            </Button>
          </div>
        </div>

        {store.quotaError ? (
          <IndexingErrorNotice
            title={t("indexing.quota.errorTitle")}
            error={store.quotaError}
            action={
              <Button
                variant="secondary"
                disabled={blocked || store.quotaLoading}
                onClick={() => void store.loadBingQuota(configPath)}
              >
                {t("common.retry")}
              </Button>
            }
          />
        ) : null}

        {store.quotaLoading ? (
          <Loading label={t("indexing.quota.refreshing")} />
        ) : null}

        {!store.quotaLoading && quotaReport ? (
          <QuotaFacts report={quotaReport} />
        ) : null}

        {!store.quotaLoading && !quotaReport && !store.quotaError && !blocked ? (
          <EmptyState
            title={t("indexing.quota.emptyTitle")}
            hint={t("indexing.quota.emptyHint")}
          />
        ) : null}

        <Warnings items={store.quotaWarnings} />
        <Limitations items={quotaReport?.limitations ?? []} />
      </section>

      <section
        className="indexing-section"
        aria-labelledby="indexing-sitescan-title"
      >
        <div className="card-header">
          <div>
            <h3 id="indexing-sitescan-title">
              {t("indexing.sitescan.title")}
            </h3>
            <p className="muted small">{t("indexing.sitescan.hint")}</p>
          </div>
          <Badge tone="neutral">{t("indexing.sitescan.noApiBadge")}</Badge>
        </div>

        <Notice variant="info">
          <span>{t("indexing.sitescan.noApi")}</span>
        </Notice>

        <div className="form-grid indexing-form">
          <Field
            id="indexing-site-url"
            label={t("indexing.sitescan.urlLabel")}
            hint={t("indexing.sitescan.urlHint")}
            error={
              siteUrlInvalid ? t("indexing.sitescan.urlInvalid") : undefined
            }
          >
            <Input
              id="indexing-site-url"
              value={store.siteUrl}
              spellCheck={false}
              autoComplete="off"
              placeholder={t("indexing.sitescan.urlPlaceholder")}
              aria-invalid={siteUrlInvalid}
              aria-describedby={
                siteUrlInvalid
                  ? "indexing-site-url-hint indexing-site-url-error"
                  : "indexing-site-url-hint"
              }
              onChange={(event) => store.setSiteUrl(event.target.value)}
            />
          </Field>
        </div>

        <div className="form-actions">
          <Button
            variant="secondary"
            loading={store.siteScanOpening}
            disabled={
              store.siteScanOpening ||
              store.siteUrl.trim() === "" ||
              !store.siteUrlValid
            }
            onClick={() => void store.openSiteScan()}
          >
            {store.siteScanOpening
              ? t("indexing.sitescan.opening")
              : t("indexing.sitescan.open")}
          </Button>
        </div>

        {store.siteScanError ? (
          <IndexingErrorNotice
            title={t("indexing.sitescan.errorTitle")}
            error={store.siteScanError}
            action={
              <Button
                variant="secondary"
                disabled={!store.siteUrlValid || store.siteScanOpening}
                onClick={() => void store.openSiteScan()}
              >
                {t("common.retry")}
              </Button>
            }
          />
        ) : null}

        {store.siteScanOpening ? (
          <Loading label={t("indexing.sitescan.opening")} />
        ) : null}

        {store.siteScanState === "opened" ? (
          <Notice variant="info">
            <strong>{t("indexing.sitescan.openedTitle")}</strong>
            <span>{t("indexing.sitescan.opened")}</span>
            {store.siteScanOpenedUrl ? (
              <code className="callback">{store.siteScanOpenedUrl}</code>
            ) : null}
          </Notice>
        ) : null}

        <p className="muted small">{t("indexing.sitescan.actionRequired")}</p>
      </section>
    </Card>
  );
});
