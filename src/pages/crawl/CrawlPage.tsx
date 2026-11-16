import { useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import {
  CRAWL_FILTERS_DEFAULT,
  crawlIssueFacets,
  crawlLimitations,
  effectiveCrawlFilters,
  filterCrawlIssues,
  sortCrawlIssues,
  type CrawlFilters,
} from "@/entities/crawl";
import { useI18n } from "@/shared/i18n";
import { appErrorText } from "@/shared/lib/errors";
import { formatDateTime, formatNumber } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { CrawlExportPanel } from "@/features/crawl/ui/CrawlExportPanel";
import { CrawlRunForm } from "@/features/crawl/ui/CrawlRunForm";
import { IssueFilters } from "@/features/crawl/ui/IssueFilters";
import { IssueTable } from "@/features/crawl/ui/IssueTable";
import { crawlCopy } from "@/features/crawl/model/copy";
import { isValidMaxUrls, isValidStartUrl } from "@/features/crawl/lib/validate";
import "./crawl.css";

/** DOM budget: the engine can return far more rows than a table should render. */
const VISIBLE_LIMIT = 500;

export const CrawlPage = observer(function CrawlPage() {
  const { t, locale } = useI18n();
  const { engine, crawl: store } = useRootStore();
  const copy = useMemo(() => crawlCopy(locale), [locale]);
  const [start, setStart] = useState("");
  const [maxUrls, setMaxUrls] = useState("");
  const [startInvalid, setStartInvalid] = useState(false);
  const [maxUrlsInvalid, setMaxUrlsInvalid] = useState(false);
  const [filters, setFilters] = useState<CrawlFilters>({
    ...CRAWL_FILTERS_DEFAULT,
  });

  const configPath = engine.status?.configPath ?? null;
  const blocked = engine.offline || engine.loading || !configPath;
  const exportDir = engine.status?.paths?.exportDir ?? null;

  const result = store.result;
  const issues = result?.issues ?? [];
  const facets = useMemo(() => crawlIssueFacets(issues), [issues]);
  const activeFilters = effectiveCrawlFilters(filters, facets);
  const visibleIssues = useMemo(
    () => sortCrawlIssues(filterCrawlIssues(issues, activeFilters)),
    [issues, activeFilters.severity, activeFilters.rule, activeFilters.query],
  );
  const displayedIssues = visibleIssues.slice(0, VISIBLE_LIMIT);
  const limitations = crawlLimitations(result, store.meta);
  const warnings = [
    ...new Set(store.warnings.filter((item) => item.trim() !== "")),
  ];

  const submit = async () => {
    if (blocked || store.loading) {
      return;
    }
    const trimmedStart = start.trim();
    const trimmedMax = maxUrls.trim();
    const badStart = !isValidStartUrl(trimmedStart);
    const badMax = !isValidMaxUrls(trimmedMax);
    setStartInvalid(badStart);
    setMaxUrlsInvalid(badMax);
    if (badStart || badMax) {
      return;
    }
    setFilters({ ...CRAWL_FILTERS_DEFAULT });
    const args: { start?: string; maxUrls?: number } = {};
    if (trimmedStart) {
      args.start = trimmedStart;
    }
    if (trimmedMax) {
      args.maxUrls = Number(trimmedMax);
    }
    await store.run(args);
  };

  const reconnect = async () => {
    await engine.load();
  };

  const resetFilters = () => setFilters({ ...CRAWL_FILTERS_DEFAULT });

  const requestText = result
    ? result.summary.request_count === null &&
      result.summary.request_budget === null
      ? "—"
      : `${formatNumber(result.summary.request_count, locale)} / ${formatNumber(
          result.summary.request_budget,
          locale,
        )}`
    : "—";

  const issueHeading = result
    ? visibleIssues.length === issues.length
      ? `${copy.issuesTitle} (${issues.length})`
      : `${copy.issuesTitle} (${visibleIssues.length} / ${issues.length})`
    : copy.issuesTitle;

  return (
    <section className="page crawl-page">
      <header className="page-header">
        <div>
          <h1>{copy.title}</h1>
          <p className="muted">{copy.subtitle}</p>
        </div>
        {store.lastRunAt ? (
          <p className="muted small">
            {copy.lastRun}: {formatDateTime(store.lastRunAt, locale)}
          </p>
        ) : null}
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
          <strong>{copy.noWorkspaceTitle}</strong>
          <span>{copy.noWorkspaceHint}</span>
        </Notice>
      ) : null}

      <Card>
        <CrawlRunForm
          copy={copy}
          start={start}
          maxUrls={maxUrls}
          startInvalid={startInvalid}
          maxUrlsInvalid={maxUrlsInvalid}
          loading={store.loading}
          disabled={blocked}
          onStartChange={(value) => {
            setStart(value);
            setStartInvalid(false);
          }}
          onMaxUrlsChange={(value) => {
            setMaxUrls(value);
            setMaxUrlsInvalid(false);
          }}
          onSubmit={() => void submit()}
        />
      </Card>

      {store.state === "cancelled" ? (
        <Notice
          variant="info"
          action={
            <Button
              variant="secondary"
              onClick={() => void submit()}
              disabled={blocked || store.loading}
            >
              {copy.retry}
            </Button>
          }
        >
          <strong>{t("runStatus.cancelled")}</strong>
          <span>{t("runStatus.cancelledHint")}</span>
        </Notice>
      ) : null}

      {store.error ? (
        <Notice
          variant="error"
          action={
            <Button
              variant="secondary"
              onClick={() => void submit()}
              disabled={blocked || store.loading}
            >
              {copy.retry}
            </Button>
          }
        >
          <strong>{copy.errorTitle}</strong>
          <span>{appErrorText(store.error)}</span>
        </Notice>
      ) : null}

      {store.loading && !result ? <Loading label={copy.loading} /> : null}

      {!result &&
      !store.loading &&
      !blocked &&
      !store.error &&
      store.state !== "cancelled" ? (
        <Card>
          <EmptyState title={copy.emptyTitle} hint={copy.emptyHint} />
        </Card>
      ) : null}

      {result ? (
        <>
          <Card>
            <div className="card-header">
              <div>
                <h2>{copy.summaryTitle}</h2>
                <p className="muted small">{copy.summaryHint}</p>
              </div>
              <div className="badge-row">
                {result.summary.truncated === true ? (
                  <Badge tone="warning">{copy.truncated}</Badge>
                ) : result.summary.truncated === false ? (
                  <Badge tone="success">{copy.notTruncated}</Badge>
                ) : null}
              </div>
            </div>

            <div className="crawl-facts">
              <div className="crawl-fact">
                <span className="muted small">{copy.statUrls}</span>
                <strong>{formatNumber(result.summary.urls, locale)}</strong>
              </div>
              <div className="crawl-fact">
                <span className="muted small">{copy.statFetched}</span>
                <strong>{formatNumber(result.summary.fetched, locale)}</strong>
              </div>
              <div className="crawl-fact">
                <span className="muted small">{copy.statErrors}</span>
                <strong>{formatNumber(result.summary.errors, locale)}</strong>
              </div>
              <div className="crawl-fact">
                <span className="muted small">{copy.statBlocked}</span>
                <strong>{formatNumber(result.summary.blocked, locale)}</strong>
              </div>
              <div className="crawl-fact">
                <span className="muted small">{copy.statIssues}</span>
                <strong>{formatNumber(result.summary.issues, locale)}</strong>
              </div>
              <div className="crawl-fact">
                <span className="muted small">{copy.statSitemap}</span>
                <strong>{formatNumber(result.summary.sitemap_urls, locale)}</strong>
              </div>
              <div className="crawl-fact">
                <span className="muted small">{copy.statRequests}</span>
                <strong>{requestText}</strong>
              </div>
            </div>

            {result.summary.start_url || result.summary.site_url ? (
              <p className="muted small crawl-source">
                {result.summary.start_url ? (
                  <span>
                    {copy.startLabel}: <code>{result.summary.start_url}</code>
                  </span>
                ) : null}
                {result.summary.site_url ? (
                  <span>
                    {copy.siteLabel}: <code>{result.summary.site_url}</code>
                  </span>
                ) : null}
              </p>
            ) : null}
          </Card>

          <Card>
            <div className="card-header">
              <div>
                <h2>{issueHeading}</h2>
                <p className="muted small">{copy.filtersTitle}</p>
              </div>
            </div>

            <IssueFilters
              copy={copy}
              facets={facets}
              filters={activeFilters}
              visibleCount={visibleIssues.length}
              totalCount={issues.length}
              onChange={setFilters}
              onReset={resetFilters}
            />

            {issues.length === 0 ? (
              <EmptyState title={copy.cleanTitle} hint={copy.cleanHint} />
            ) : visibleIssues.length === 0 ? (
              <EmptyState
                title={copy.filteredEmptyTitle}
                hint={copy.filteredEmptyHint}
                action={
                  <Button variant="secondary" onClick={resetFilters}>
                    {copy.resetFilters}
                  </Button>
                }
              />
            ) : (
              <>
                {visibleIssues.length > VISIBLE_LIMIT ? (
                  <Notice variant="info">
                    <span>
                      {copy.tableCap
                        .replace("{shown}", String(displayedIssues.length))
                        .replace("{total}", String(visibleIssues.length))}
                    </span>
                  </Notice>
                ) : null}
                <IssueTable copy={copy} issues={displayedIssues} />
              </>
            )}
          </Card>

          {limitations.length ? (
            <Card>
              <h3>{copy.limitations}</h3>
              <ul className="report-notes">
                {limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {warnings.length ? (
            <Card>
              <h3>{copy.warnings}</h3>
              <ul className="report-notes">
                {warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <CrawlExportPanel
            copy={copy}
            store={store}
            exportDir={exportDir}
          />
        </>
      ) : null}
    </section>
  );
});
