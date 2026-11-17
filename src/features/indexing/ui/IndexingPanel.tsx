import { useEffect, useState, type ReactNode } from "react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n, type MessageKey } from "@/shared/i18n";
import { appErrorText, type AppError } from "@/shared/lib/errors";
import { formatNumber } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { Table } from "@/shared/ui/Table";
import {
  indexingErrorHint,
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
}: {
  title: string;
  plan: IndexingPlan;
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

      {plan.details.length ? (
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
}: {
  title: string;
  outcome: IndexingOutcome;
  counting?: boolean;
}) {
  const { t, locale } = useI18n();
  const tone =
    outcome.status === "applied"
      ? "success"
      : outcome.status === "skipped"
        ? "warning"
        : "neutral";
  return (
    <div className="stack indexing-outcome">
      <div className="card-header">
        <h4>{title}</h4>
        <Badge tone={tone}>{t(STATUS_KEYS[outcome.status])}</Badge>
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

      {outcome.details.length ? (
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

/**
 * Bing indexing actions: two-phase sitemap submit and IndexNow-from-sitemap,
 * plus an opener for the official Site Scan page. Bing has no public API for
 * starting a Site Scan, so the last action never claims to start one.
 */
export const IndexingPanel = observer(function IndexingPanel() {
  const { t } = useI18n();
  const { engine, indexing: store } = useRootStore();
  const [sitemapConfirmOpen, setSitemapConfirmOpen] = useState(false);
  const [indexNowConfirmOpen, setIndexNowConfirmOpen] = useState(false);

  useEffect(
    () => () => {
      // Leaving the page must not leave a confirmation armed.
      store.cancelSitemapApply();
      store.cancelIndexNowApply();
    },
    [store],
  );

  const configPath = engine.status?.configPath ?? null;
  const blocked = engine.offline || engine.loading || !configPath;
  const sitemapBusy = store.sitemapPlanning || store.sitemapApplying;
  const indexNowBusy = store.indexNowPlanning || store.indexNowApplying;
  const sitemapValue = store.sitemapRequestUrl;
  const sitemapError = store.sitemapUrlInvalid
    ? t("indexing.sitemap.urlInvalid")
    : undefined;
  const siteUrlInvalid =
    store.siteUrl.trim() !== "" && !store.siteUrlValid;
  const sitemapPlan = store.sitemapPlan;
  const indexNowPlan = store.indexNowPlan;
  const defaultSitemap = t("indexing.defaultSitemap");

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
