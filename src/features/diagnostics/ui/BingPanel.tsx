import { observer } from "mobx-react-lite";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n } from "@/shared/i18n";
import { formatDateTime, formatNumber } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { Loading } from "@/shared/ui/Loading";
import { Table } from "@/shared/ui/Table";
import { emptyReason } from "../model/types";
import {
  EmptyReport,
  ErrorNotice,
  Fact,
  MetaNotes,
  Section,
  Warnings,
} from "./shared";

export const BingPanel = observer(function BingPanel() {
  const { t, locale } = useI18n();
  const { engine, diagnostics: store } = useRootStore();
  const configPath = engine.status?.configPath ?? null;
  const blocked = engine.offline || engine.loading || !configPath;

  const pages = store.bingPages;
  const traffic = store.bingTraffic;
  const crawl = store.bingCrawl;
  const urlinfo = store.bingUrlinfo;
  const joins = store.bingJoins;

  const pagesReport = pages.report;
  const trafficReport = traffic.report;
  const crawlReport = crawl.report;
  const urlinfoReport = urlinfo.report;
  const joinsReport = joins.report;

  return (
    <>
      <Section
        id="diagnostics-bing-urlinfo"
        title={t("diagnostics.bing.urlinfoTitle")}
        hint={t("diagnostics.bing.urlinfoHint")}
        actions={
          <>
            <Badge tone="neutral">{t("diagnostics.readOnly")}</Badge>
            <Button
              variant="secondary"
              loading={urlinfo.loading}
              disabled={blocked || urlinfo.loading}
              onClick={() => void store.loadBingUrlinfo(configPath)}
            >
              {urlinfo.loading
                ? t("diagnostics.loading")
                : t("diagnostics.load")}
            </Button>
          </>
        }
      >
        <div className="form-grid diagnostics-form">
          <Field
            id="diagnostics-bing-url"
            label={t("diagnostics.bing.urlLabel")}
            hint={t("diagnostics.bing.urlHint")}
          >
            <Input
              id="diagnostics-bing-url"
              value={store.bingUrl}
              spellCheck={false}
              autoComplete="off"
              placeholder={t("diagnostics.bing.urlPlaceholder")}
              onChange={(event) => {
                store.bingUrl = event.target.value;
              }}
            />
          </Field>
        </div>

        {urlinfo.error ? (
          <ErrorNotice
            title={t("diagnostics.bing.urlinfoError")}
            error={urlinfo.error}
            onRetry={() => void store.loadBingUrlinfo(configPath)}
          />
        ) : null}
        {urlinfo.loading ? (
          <Loading label={t("diagnostics.loading")} />
        ) : null}

        {!urlinfo.loading && urlinfoReport && urlinfoReport.rows.length ? (
          <>
            {urlinfoReport.rows.map((row, index) => (
              <div
                className="diagnostics-facts"
                key={`${row.url ?? "url"}-${index}`}
              >
                <Fact
                  label={t("diagnostics.bing.columnUrl")}
                  value={<code>{row.url ?? t("common.notAvailable")}</code>}
                />
                <Fact
                  label={t("diagnostics.bing.columnHttp")}
                  value={formatNumber(row.httpStatus, locale)}
                />
                <Fact
                  label={t("diagnostics.bing.columnIsPage")}
                  value={
                    row.isPage === null
                      ? t("common.notAvailable")
                      : row.isPage
                        ? t("common.yes")
                        : t("common.no")
                  }
                />
                <Fact
                  label={t("diagnostics.bing.columnLastCrawled")}
                  value={
                    row.lastCrawledDate
                      ? formatDateTime(row.lastCrawledDate, locale)
                      : t("diagnostics.bing.neverCrawled")
                  }
                />
                <Fact
                  label={t("diagnostics.bing.columnDiscovery")}
                  value={
                    row.discoveryDate
                      ? formatDateTime(row.discoveryDate, locale)
                      : t("common.notAvailable")
                  }
                />
                <Fact
                  label={t("diagnostics.bing.columnChildren")}
                  value={formatNumber(row.totalChildUrlCount, locale)}
                />
                <Fact
                  label={t("diagnostics.bing.columnAnchors")}
                  value={formatNumber(row.anchorCount, locale)}
                />
                <Fact
                  label={t("diagnostics.bing.columnSize")}
                  value={formatNumber(row.documentSize, locale)}
                />
              </div>
            ))}
            <MetaNotes meta={urlinfoReport.meta} />
            <Warnings items={urlinfo.warnings} />
          </>
        ) : null}

        {!urlinfo.loading && urlinfoReport && !urlinfoReport.rows.length ? (
          <EmptyReport
            reason={emptyReason(urlinfoReport.meta) ?? "provider_returned_no_rows"}
            title={t("diagnostics.bing.urlinfoEmptyTitle")}
            hint={t("diagnostics.bing.urlinfoEmptyHint")}
          />
        ) : null}

        {!urlinfo.loading && !urlinfoReport && !urlinfo.error && !blocked ? (
          <p className="muted small">{t("diagnostics.bing.urlinfoIdle")}</p>
        ) : null}
      </Section>

      <Section
        id="diagnostics-bing-pages"
        title={t("diagnostics.bing.pagesTitle")}
        hint={t("diagnostics.bing.pagesHint")}
        actions={
          <>
            <Badge tone="neutral">{t("diagnostics.readOnly")}</Badge>
            <Button
              variant="secondary"
              loading={pages.loading}
              disabled={blocked || pages.loading}
              onClick={() => void store.loadBingPages(configPath)}
            >
              {pages.loading
                ? t("diagnostics.loading")
                : t("diagnostics.load")}
            </Button>
          </>
        }
      >
        {pages.error ? (
          <ErrorNotice
            title={t("diagnostics.bing.pagesError")}
            error={pages.error}
            onRetry={() => void store.loadBingPages(configPath)}
          />
        ) : null}
        {pages.loading ? <Loading label={t("diagnostics.loading")} /> : null}

        {!pages.loading && pagesReport && pagesReport.rows.length ? (
          <Table caption={t("diagnostics.bing.pagesTitle")}>
            <thead>
              <tr>
                <th scope="col">{t("diagnostics.bing.columnPage")}</th>
                <th scope="col">{t("diagnostics.bing.columnClicks")}</th>
                <th scope="col">{t("diagnostics.bing.columnImpressions")}</th>
                <th scope="col">{t("diagnostics.bing.columnClickPosition")}</th>
                <th scope="col">
                  {t("diagnostics.bing.columnImpressionPosition")}
                </th>
                <th scope="col">{t("diagnostics.bing.columnDate")}</th>
              </tr>
            </thead>
            <tbody>
              {pagesReport.rows.map((row, index) => (
                <tr key={`${row.page ?? "page"}-${index}`}>
                  <td>
                    <code>{row.page ?? t("common.notAvailable")}</code>
                  </td>
                  <td>{formatNumber(row.clicks, locale)}</td>
                  <td>{formatNumber(row.impressions, locale)}</td>
                  <td>{formatNumber(row.clickPosition, locale, 1)}</td>
                  <td>{formatNumber(row.impressionPosition, locale, 1)}</td>
                  <td>{row.date ?? t("common.notAvailable")}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {!pages.loading && pagesReport && !pagesReport.rows.length ? (
          <EmptyReport
            reason={emptyReason(pagesReport.meta) ?? "no_rows_for_window"}
            title={t("diagnostics.bing.pagesEmptyTitle")}
            hint={t("diagnostics.bing.pagesEmptyHint")}
          />
        ) : null}

        {!pages.loading && !pagesReport && !pages.error && !blocked ? (
          <p className="muted small">{t("diagnostics.bing.pagesIdle")}</p>
        ) : null}

        {pagesReport ? <MetaNotes meta={pagesReport.meta} /> : null}
        <Warnings items={pages.warnings} />
      </Section>

      <Section
        id="diagnostics-bing-traffic"
        title={t("diagnostics.bing.trafficTitle")}
        hint={t("diagnostics.bing.trafficHint")}
        actions={
          <>
            <Badge tone="neutral">{t("diagnostics.readOnly")}</Badge>
            <Button
              variant="secondary"
              loading={traffic.loading}
              disabled={blocked || traffic.loading}
              onClick={() => void store.loadBingTraffic(configPath)}
            >
              {traffic.loading
                ? t("diagnostics.loading")
                : t("diagnostics.load")}
            </Button>
          </>
        }
      >
        {traffic.error ? (
          <ErrorNotice
            title={t("diagnostics.bing.trafficError")}
            error={traffic.error}
            onRetry={() => void store.loadBingTraffic(configPath)}
          />
        ) : null}
        {traffic.loading ? (
          <Loading label={t("diagnostics.loading")} />
        ) : null}

        {!traffic.loading && trafficReport && trafficReport.rows.length ? (
          <Table caption={t("diagnostics.bing.trafficTitle")}>
            <thead>
              <tr>
                <th scope="col">{t("diagnostics.bing.columnDate")}</th>
                <th scope="col">{t("diagnostics.bing.columnClicks")}</th>
                <th scope="col">{t("diagnostics.bing.columnImpressions")}</th>
              </tr>
            </thead>
            <tbody>
              {trafficReport.rows.map((row, index) => (
                <tr key={`${row.date ?? "date"}-${index}`}>
                  <td>{row.date ?? t("common.notAvailable")}</td>
                  <td>{formatNumber(row.clicks, locale)}</td>
                  <td>{formatNumber(row.impressions, locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {!traffic.loading && trafficReport && !trafficReport.rows.length ? (
          <EmptyReport
            reason={emptyReason(trafficReport.meta) ?? "no_rows_for_window"}
            title={t("diagnostics.bing.trafficEmptyTitle")}
            hint={t("diagnostics.bing.trafficEmptyHint")}
          />
        ) : null}

        {!traffic.loading && !trafficReport && !traffic.error && !blocked ? (
          <p className="muted small">{t("diagnostics.bing.trafficIdle")}</p>
        ) : null}

        {trafficReport ? <MetaNotes meta={trafficReport.meta} /> : null}
        <Warnings items={traffic.warnings} />
      </Section>

      <Section
        id="diagnostics-bing-crawl"
        title={t("diagnostics.bing.crawlTitle")}
        hint={t("diagnostics.bing.crawlHint")}
        actions={
          <>
            <Badge tone="neutral">{t("diagnostics.readOnly")}</Badge>
            <Button
              variant="secondary"
              loading={crawl.loading}
              disabled={blocked || crawl.loading}
              onClick={() => void store.loadBingCrawl(configPath)}
            >
              {crawl.loading
                ? t("diagnostics.loading")
                : t("diagnostics.load")}
            </Button>
          </>
        }
      >
        <p className="muted small">{t("diagnostics.bing.sixMonths")}</p>
        {crawl.error ? (
          <ErrorNotice
            title={t("diagnostics.bing.crawlError")}
            error={crawl.error}
            onRetry={() => void store.loadBingCrawl(configPath)}
          />
        ) : null}
        {crawl.loading ? <Loading label={t("diagnostics.loading")} /> : null}

        {!crawl.loading && crawlReport && crawlReport.rows.length ? (
          <Table caption={t("diagnostics.bing.crawlTitle")}>
            <thead>
              <tr>
                <th scope="col">{t("diagnostics.bing.columnDate")}</th>
                <th scope="col">{t("diagnostics.bing.column2xx")}</th>
                <th scope="col">{t("diagnostics.bing.column301")}</th>
                <th scope="col">{t("diagnostics.bing.column302")}</th>
                <th scope="col">{t("diagnostics.bing.column4xx")}</th>
                <th scope="col">{t("diagnostics.bing.column5xx")}</th>
                <th scope="col">{t("diagnostics.bing.columnCrawlErrors")}</th>
                <th scope="col">{t("diagnostics.bing.columnInIndex")}</th>
                <th scope="col">{t("diagnostics.bing.columnInLinks")}</th>
              </tr>
            </thead>
            <tbody>
              {crawlReport.rows.map((row, index) => (
                <tr key={`${row.date ?? "date"}-${index}`}>
                  <td>{row.date ?? t("common.notAvailable")}</td>
                  <td>{formatNumber(row.code2xx, locale)}</td>
                  <td>{formatNumber(row.code301, locale)}</td>
                  <td>{formatNumber(row.code302, locale)}</td>
                  <td>{formatNumber(row.code4xx, locale)}</td>
                  <td>{formatNumber(row.code5xx, locale)}</td>
                  <td>{formatNumber(row.crawlErrors, locale)}</td>
                  <td>{formatNumber(row.inIndex, locale)}</td>
                  <td>{formatNumber(row.inLinks, locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {!crawl.loading && crawlReport && !crawlReport.rows.length ? (
          <EmptyReport
            reason={emptyReason(crawlReport.meta) ?? "no_rows_for_window"}
            title={t("diagnostics.bing.crawlEmptyTitle")}
            hint={t("diagnostics.bing.crawlEmptyHint")}
          />
        ) : null}

        {!crawl.loading && !crawlReport && !crawl.error && !blocked ? (
          <p className="muted small">{t("diagnostics.bing.crawlIdle")}</p>
        ) : null}

        {crawlReport ? <MetaNotes meta={crawlReport.meta} /> : null}
        <Warnings items={crawl.warnings} />
      </Section>

      <Section
        id="diagnostics-bing-joins"
        title={t("diagnostics.bing.joinsTitle")}
        hint={t("diagnostics.bing.joinsHint")}
        actions={
          <>
            <Badge tone="neutral">{t("diagnostics.readOnly")}</Badge>
            <Button
              variant="secondary"
              loading={joins.loading}
              disabled={blocked || joins.loading}
              onClick={() => void store.loadBingJoins(configPath)}
            >
              {joins.loading
                ? t("diagnostics.loading")
                : t("diagnostics.load")}
            </Button>
          </>
        }
      >
        <div className="form-grid diagnostics-form">
          <Field
            id="diagnostics-bing-query"
            label={t("diagnostics.bing.queryLabel")}
            hint={t("diagnostics.bing.queryHint")}
          >
            <Input
              id="diagnostics-bing-query"
              value={store.bingQuery}
              spellCheck={false}
              autoComplete="off"
              placeholder={t("diagnostics.bing.queryPlaceholder")}
              onChange={(event) => {
                store.bingQuery = event.target.value;
              }}
            />
          </Field>
          <Field
            id="diagnostics-bing-page"
            label={t("diagnostics.bing.pageLabel")}
            hint={t("diagnostics.bing.pageHint")}
          >
            <Input
              id="diagnostics-bing-page"
              value={store.bingPage}
              spellCheck={false}
              autoComplete="off"
              placeholder={t("diagnostics.bing.pagePlaceholder")}
              onChange={(event) => {
                store.bingPage = event.target.value;
              }}
            />
          </Field>
        </div>

        {joins.error ? (
          <ErrorNotice
            title={t("diagnostics.bing.joinsError")}
            error={joins.error}
            onRetry={() => void store.loadBingJoins(configPath)}
          />
        ) : null}
        {joins.loading ? <Loading label={t("diagnostics.loading")} /> : null}

        {!joins.loading && joinsReport ? (
          <div className="diagnostics-facts">
            <Fact
              label={t("diagnostics.bing.joinMode")}
              value={joinsReport.mode ?? t("common.notAvailable")}
            />
            {joinsReport.query ? (
              <Fact label={t("diagnostics.bing.queryLabel")} value={joinsReport.query} />
            ) : null}
            {joinsReport.page ? (
              <Fact
                label={t("diagnostics.bing.pageLabel")}
                value={<code>{joinsReport.page}</code>}
              />
            ) : null}
          </div>
        ) : null}

        {!joins.loading && joinsReport && joinsReport.rows.length ? (
          <Table caption={t("diagnostics.bing.joinsTitle")}>
            <thead>
              <tr>
                <th scope="col">{t("diagnostics.bing.columnQuery")}</th>
                <th scope="col">{t("diagnostics.bing.columnPage")}</th>
                <th scope="col">{t("diagnostics.bing.columnClicks")}</th>
                <th scope="col">{t("diagnostics.bing.columnImpressions")}</th>
                <th scope="col">{t("diagnostics.bing.columnPosition")}</th>
                <th scope="col">{t("diagnostics.bing.columnDate")}</th>
              </tr>
            </thead>
            <tbody>
              {joinsReport.rows.map((row, index) => (
                <tr key={`${row.query ?? "q"}-${row.page ?? "p"}-${index}`}>
                  <td>{row.query ?? t("common.notAvailable")}</td>
                  <td>
                    <code>{row.page ?? t("common.notAvailable")}</code>
                  </td>
                  <td>{formatNumber(row.clicks, locale)}</td>
                  <td>{formatNumber(row.impressions, locale)}</td>
                  <td>{formatNumber(row.position, locale, 1)}</td>
                  <td>{row.date ?? t("common.notAvailable")}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {!joins.loading && joinsReport && !joinsReport.rows.length ? (
          <EmptyReport
            reason={emptyReason(joinsReport.meta) ?? "no_rows_for_window"}
            title={t("diagnostics.bing.joinsEmptyTitle")}
            hint={t("diagnostics.bing.joinsEmptyHint")}
          />
        ) : null}

        {!joins.loading && !joinsReport && !joins.error && !blocked ? (
          <p className="muted small">{t("diagnostics.bing.joinsIdle")}</p>
        ) : null}

        {joinsReport ? <MetaNotes meta={joinsReport.meta} /> : null}
        <Warnings items={joins.warnings} />
      </Section>
    </>
  );
});
