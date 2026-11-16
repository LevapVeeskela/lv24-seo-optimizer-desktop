import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/app/routes";
import { useConfirmWorkspaceChange } from "@/app/providers/DiscardGuard";
import { useRootStore } from "@/app/providers/StoreProvider";
import {
  PORTFOLIO_SORT_DEFAULT,
  PORTFOLIO_SORTS,
  PortfolioStore,
  PortfolioTable,
  filterPortfolioSites,
  isPortfolioSort,
  openPortfolioSite,
  sortPortfolioSites,
  type PortfolioSite,
  type PortfolioSort,
} from "@/entities/portfolio";
import { pickDirectory } from "@/shared/desktop/dialog";
import { useI18n } from "@/shared/i18n";
import { appErrorText, toAppError } from "@/shared/lib/errors";
import { formatDateTime, formatNumber } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { Select } from "@/shared/ui/Select";
import { useFeedback } from "@/shared/ui/Feedback";
import "./portfolio.css";

const SORT_LABEL_KEYS = {
  issues: "portfolio.sort.issues",
  name: "portfolio.sort.name",
  lastActivity: "portfolio.sort.lastActivity",
  errors: "portfolio.sort.errors",
} as const;

/**
 * Multi-site portfolio roll-up. The root folder is chosen with the shell's
 * directory picker; the engine scans it and returns one row per project. Every
 * row opens through the existing workspace flow, so the active workspace and
 * the rest of the app stay consistent.
 */
export const PortfolioPage = observer(function PortfolioPage() {
  const { t, locale } = useI18n();
  const { engine, workspace } = useRootStore();
  const { notify } = useFeedback();
  const navigate = useNavigate();
  const confirmWorkspaceChange = useConfirmWorkspaceChange();
  const [store] = useState(() => new PortfolioStore());
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PortfolioSort>(PORTFOLIO_SORT_DEFAULT);

  const blocked = engine.state !== "ready";
  const visibleSites = useMemo(
    () => sortPortfolioSites(filterPortfolioSites(store.sites, query), sort),
    [store.sites, query, sort],
  );
  const warnings = [
    ...new Set(store.warnings.filter((item) => item.trim() !== "")),
  ];

  useEffect(() => {
    // A remembered root is scanned once the shell reports a usable engine; the
    // state guard keeps the effect idempotent across re-renders.
    if (!blocked && store.root && store.state === "idle") {
      void store.load();
    }
  }, [blocked, store]);

  const chooseRoot = async () => {
    setPicking(true);
    setPickError(null);
    try {
      const selected = await pickDirectory();
      if (!selected) {
        return;
      }
      store.setRoot(selected);
      setQuery("");
      await store.load(selected);
    } catch (error) {
      setPickError(
        `${t("portfolio.pickFailed")} ${toAppError(error, "PICK_DIRECTORY").message}`,
      );
    } finally {
      setPicking(false);
    }
  };

  const openSite = async (site: PortfolioSite) => {
    if (!(await confirmWorkspaceChange())) {
      return;
    }
    const result = await openPortfolioSite(workspace, site);
    if (result.ok) {
      notify(t("workspace.activated", { label: site.name }), "success");
      navigate(ROUTES.dashboard);
      return;
    }
    notify(appErrorText(result.error), "error");
  };

  const root = store.root;
  const ready = store.state === "ready";
  const hasRoot = root !== null;

  return (
    <section className="page portfolio-page">
      <header className="page-header">
        <div>
          <h1>{t("portfolio.title")}</h1>
          <p className="muted">{t("portfolio.subtitle")}</p>
        </div>
        <div className="page-actions">
          <Button
            variant="primary"
            loading={store.loading}
            disabled={blocked || !hasRoot || store.loading}
            onClick={() => void store.refresh()}
          >
            {store.loading ? t("portfolio.refreshing") : t("portfolio.refresh")}
          </Button>
        </div>
      </header>

      {engine.offline ? (
        <Notice
          variant="info"
          action={
            <Button variant="secondary" onClick={() => void engine.load()}>
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("portfolio.offlineTitle")}</strong>
          <span>{t("portfolio.offlineHint")}</span>
        </Notice>
      ) : null}

      <Card>
        <Field
          id="portfolio-root"
          label={t("portfolio.rootLabel")}
          hint={t("portfolio.rootHint")}
        >
          <div className="portfolio-root-row">
            <Input
              id="portfolio-root"
              readOnly
              value={root ?? ""}
              placeholder={t("portfolio.noRoot")}
              aria-describedby="portfolio-root-hint"
            />
            <Button
              variant="secondary"
              loading={picking}
              disabled={blocked || picking}
              onClick={() => void chooseRoot()}
            >
              {hasRoot ? t("portfolio.changeRoot") : t("portfolio.chooseRoot")}
            </Button>
          </div>
        </Field>

        {pickError ? (
          <Notice variant="error">
            <span>{pickError}</span>
          </Notice>
        ) : null}
      </Card>

      {store.error ? (
        <Notice
          variant="error"
          action={
            <Button
              variant="secondary"
              disabled={blocked || !hasRoot || store.loading}
              onClick={() => void store.refresh()}
            >
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("portfolio.errorTitle")}</strong>
          <span>{appErrorText(store.error)}</span>
          <code className="callback">
            {t("integrations.errorCode", { code: store.error.code })}
          </code>
        </Notice>
      ) : null}

      {!hasRoot && !store.loading ? (
        <Card>
          <EmptyState
            title={t("portfolio.noRootTitle")}
            hint={t("portfolio.noRootHint")}
            action={
              <Button
                variant="primary"
                loading={picking}
                disabled={blocked || picking}
                onClick={() => void chooseRoot()}
              >
                {t("portfolio.chooseRoot")}
              </Button>
            }
          />
        </Card>
      ) : null}

      {hasRoot && store.loading && !store.hasSites ? (
        <Loading label={t("portfolio.loading")} />
      ) : null}

      {hasRoot && ready && !store.hasSites ? (
        <Card>
          <EmptyState
            title={t("portfolio.emptyTitle")}
            hint={t("portfolio.emptyHint")}
            action={
              <Button
                variant="secondary"
                loading={picking}
                disabled={blocked || picking}
                onClick={() => void chooseRoot()}
              >
                {t("portfolio.changeRoot")}
              </Button>
            }
          />
        </Card>
      ) : null}

      {store.hasSites ? (
        <>
          <Card>
            <div className="card-header">
              <div>
                <h2>{t("portfolio.summaryTitle")}</h2>
                <p className="muted small">{t("portfolio.summaryHint")}</p>
              </div>
              <div className="badge-row">
                {store.truncated ? (
                  <Badge tone="warning">
                    {t("portfolio.sitesShown", {
                      shown: store.sites.length,
                      total: store.total,
                    })}
                  </Badge>
                ) : null}
                {store.skipped > 0 ? (
                  <Badge tone="warning">
                    {t("portfolio.skipped", { count: store.skipped })}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="portfolio-facts">
              <div className="portfolio-fact">
                <span className="muted small">{t("portfolio.root")}</span>
                <code>{root}</code>
              </div>
              <div className="portfolio-fact">
                <span className="muted small">{t("portfolio.siteCount")}</span>
                <strong>{formatNumber(store.sites.length, locale)}</strong>
              </div>
              <div className="portfolio-fact">
                <span className="muted small">{t("portfolio.issueCount")}</span>
                <strong>{formatNumber(store.issueTotal, locale)}</strong>
                {store.issueUnknownCount > 0 ? (
                  <span className="muted small">
                    {t("portfolio.issueUnknown", {
                      count: store.issueUnknownCount,
                    })}
                  </span>
                ) : null}
              </div>
              <div className="portfolio-fact">
                <span className="muted small">{t("portfolio.errorCount")}</span>
                <strong>{formatNumber(store.errorCount, locale)}</strong>
              </div>
              {store.lastLoadedAt ? (
                <div className="portfolio-fact">
                  <span className="muted small">
                    {t("portfolio.lastLoaded")}
                  </span>
                  <strong>
                    {formatDateTime(store.lastLoadedAt, locale)}
                  </strong>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <div className="card-header">
              <div>
                <h2>{t("portfolio.sitesTitle")}</h2>
                <p className="muted small">{t("portfolio.sitesHint")}</p>
              </div>
              <p className="muted small">
                {t("portfolio.sitesShown", {
                  shown: visibleSites.length,
                  total: store.sites.length,
                })}
              </p>
            </div>

            <div className="form-grid portfolio-filters">
              <Field
                id="portfolio-filter"
                label={t("portfolio.filterLabel")}
              >
                <Input
                  id="portfolio-filter"
                  value={query}
                  placeholder={t("portfolio.filterPlaceholder")}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </Field>
              <Field id="portfolio-sort" label={t("portfolio.sortLabel")}>
                <Select
                  id="portfolio-sort"
                  value={sort}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (isPortfolioSort(next)) {
                      setSort(next);
                    }
                  }}
                >
                  {PORTFOLIO_SORTS.map((option) => (
                    <option key={option} value={option}>
                      {t(SORT_LABEL_KEYS[option])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {visibleSites.length ? (
              <PortfolioTable
                sites={visibleSites}
                activePath={engine.status?.configPath ?? null}
                busyPath={workspace.activatingPath}
                onOpen={(site) => void openSite(site)}
              />
            ) : (
              <EmptyState
                title={t("portfolio.filteredEmptyTitle")}
                hint={t("portfolio.filteredEmptyHint")}
                action={
                  <Button variant="secondary" onClick={() => setQuery("")}>
                    {t("portfolio.filterReset")}
                  </Button>
                }
              />
            )}
          </Card>

          {store.limitations.length ? (
            <Card>
              <h3>{t("portfolio.limitations")}</h3>
              <ul className="report-notes">
                {store.limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {warnings.length ? (
            <Card>
              <h3>{t("portfolio.warnings")}</h3>
              <ul className="report-notes">
                {warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}
    </section>
  );
});
