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

function contentsText(
  contents: Array<{
    type: string | null;
    submitted: number | null;
  }>,
  locale: string,
  fallback: string,
): string {
  if (!contents.length) {
    return fallback;
  }
  return contents
    .map(
      (item) =>
        `${item.type ?? "—"}: ${formatNumber(item.submitted, locale)}`,
    )
    .join(", ");
}

export const GooglePanel = observer(function GooglePanel() {
  const { t, locale } = useI18n();
  const { engine, diagnostics: store } = useRootStore();
  const configPath = engine.status?.configPath ?? null;
  const blocked = engine.offline || engine.loading || !configPath;

  const inspect = store.gscInspect;
  const sitemaps = store.gscSitemaps;
  const inspection = inspect.report;
  const sitemapsReport = sitemaps.report;
  const sitemapsEmpty = sitemapsReport
    ? emptyReason(sitemapsReport.meta)
    : null;

  return (
    <>
      <Section
        id="diagnostics-gsc-inspect"
        title={t("diagnostics.google.inspectTitle")}
        hint={t("diagnostics.google.inspectHint")}
        actions={
          <>
            <Badge tone="neutral">{t("diagnostics.readOnly")}</Badge>
            <Button
              variant="secondary"
              loading={inspect.loading}
              disabled={blocked || inspect.loading}
              onClick={() => void store.loadGscInspect(configPath)}
            >
              {inspect.loading
                ? t("diagnostics.google.inspecting")
                : t("diagnostics.google.inspect")}
            </Button>
          </>
        }
      >
        <div className="form-grid diagnostics-form">
          <Field
            id="diagnostics-gsc-url"
            label={t("diagnostics.google.urlLabel")}
            hint={t("diagnostics.google.urlHint")}
          >
            <Input
              id="diagnostics-gsc-url"
              value={store.gscUrl}
              spellCheck={false}
              autoComplete="off"
              placeholder={t("diagnostics.google.urlPlaceholder")}
              onChange={(event) => {
                store.gscUrl = event.target.value;
              }}
            />
          </Field>
          <Field
            id="diagnostics-gsc-language"
            label={t("diagnostics.google.languageLabel")}
            hint={t("diagnostics.google.languageHint")}
          >
            <Input
              id="diagnostics-gsc-language"
              value={store.gscLanguage}
              spellCheck={false}
              autoComplete="off"
              placeholder="en-US"
              onChange={(event) => {
                store.gscLanguage = event.target.value;
              }}
            />
          </Field>
        </div>

        {inspect.error ? (
          <ErrorNotice
            title={t("diagnostics.google.inspectError")}
            error={inspect.error}
            onRetry={() => void store.loadGscInspect(configPath)}
          />
        ) : null}
        {inspect.loading ? (
          <Loading label={t("diagnostics.google.inspecting")} />
        ) : null}

        {!inspect.loading && inspection && !inspection.url ? (
          <EmptyReport
            reason="provider_returned_no_rows"
            title={t("diagnostics.google.inspectEmptyTitle")}
            hint={t("diagnostics.google.inspectEmptyHint")}
          />
        ) : null}

        {!inspect.loading && inspection && inspection.url ? (
          <>
            <div className="diagnostics-facts">
              <Fact
                label={t("diagnostics.google.verdict")}
                value={inspection.verdict ?? t("common.notAvailable")}
              />
              <Fact
                label={t("diagnostics.google.coverage")}
                value={inspection.coverageState ?? t("common.notAvailable")}
              />
              <Fact
                label={t("diagnostics.google.canonical")}
                value={inspection.canonical ?? t("common.notAvailable")}
              />
              <Fact
                label={t("diagnostics.google.crawledAs")}
                value={inspection.crawledAs ?? t("common.notAvailable")}
              />
              <Fact
                label={t("diagnostics.google.lastCrawl")}
                value={
                  inspection.lastCrawlTime
                    ? formatDateTime(inspection.lastCrawlTime, locale)
                    : t("common.notAvailable")
                }
              />
              <Fact
                label={t("diagnostics.google.indexing")}
                value={inspection.indexingState ?? t("common.notAvailable")}
              />
              <Fact
                label={t("diagnostics.google.robots")}
                value={inspection.robotsTxtState ?? t("common.notAvailable")}
              />
              <Fact
                label={t("diagnostics.google.fetch")}
                value={inspection.pageFetchState ?? t("common.notAvailable")}
              />
            </div>

            <div>
              <h4>{t("diagnostics.google.richResults")}</h4>
              <p>
                {inspection.richResults?.verdict ??
                  t("common.notAvailable")}
              </p>
              {inspection.richResults?.items.length ? (
                <ul className="diagnostics-list">
                  {inspection.richResults.items.map((item, index) => (
                    <li key={`${item.type ?? "type"}-${index}`}>
                      {item.type ?? t("common.notAvailable")} —{" "}
                      {t("diagnostics.google.issueCount", {
                        count: formatNumber(item.issueCount, locale),
                      })}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">
                  {t("diagnostics.google.noDetectedItems")}
                </p>
              )}
            </div>

            <div>
              <h4>
                {t("diagnostics.google.referringUrls", {
                  count: formatNumber(
                    inspection.referringUrls.length,
                    locale,
                  ),
                })}
              </h4>
              {inspection.referringUrls.length ? (
                <ul className="diagnostics-list">
                  {inspection.referringUrls.slice(0, 25).map((url) => (
                    <li key={url}>
                      <code>{url}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">
                  {t("diagnostics.google.noReferringUrls")}
                </p>
              )}
            </div>

            {inspection.inspectionLink ? (
              <p className="muted small">
                {t("diagnostics.google.detailsLink")}{" "}
                <code>{inspection.inspectionLink}</code>
              </p>
            ) : null}

            <MetaNotes meta={inspection.meta} />
            <Warnings items={inspect.warnings} />
          </>
        ) : null}

        {!inspect.loading && !inspection && !inspect.error && !blocked ? (
          <p className="muted small">{t("diagnostics.google.inspectIdle")}</p>
        ) : null}
      </Section>

      <Section
        id="diagnostics-gsc-sitemaps"
        title={t("diagnostics.google.sitemapsTitle")}
        hint={t("diagnostics.google.sitemapsHint")}
        actions={
          <>
            <Badge tone="neutral">{t("diagnostics.readOnly")}</Badge>
            <Button
              variant="secondary"
              loading={sitemaps.loading}
              disabled={blocked || sitemaps.loading}
              onClick={() => void store.loadGscSitemaps(configPath)}
            >
              {sitemaps.loading
                ? t("diagnostics.loading")
                : t("diagnostics.load")}
            </Button>
          </>
        }
      >
        <div className="form-grid diagnostics-form">
          <Field
            id="diagnostics-gsc-sitemap-index"
            label={t("diagnostics.google.indexLabel")}
            hint={t("diagnostics.google.indexHint")}
          >
            <Input
              id="diagnostics-gsc-sitemap-index"
              value={store.gscSitemapIndex}
              spellCheck={false}
              autoComplete="off"
              placeholder="https://example.com/sitemap.xml"
              onChange={(event) => {
                store.gscSitemapIndex = event.target.value;
              }}
            />
          </Field>
        </div>

        {sitemaps.error ? (
          <ErrorNotice
            title={t("diagnostics.google.sitemapsError")}
            error={sitemaps.error}
            onRetry={() => void store.loadGscSitemaps(configPath)}
          />
        ) : null}
        {sitemaps.loading ? (
          <Loading label={t("diagnostics.loading")} />
        ) : null}

        {!sitemaps.loading && sitemapsReport && sitemapsReport.rows.length ? (
          <Table caption={t("diagnostics.google.sitemapsTitle")}>
            <thead>
              <tr>
                <th scope="col">{t("diagnostics.google.columnPath")}</th>
                <th scope="col">{t("diagnostics.google.columnType")}</th>
                <th scope="col">{t("diagnostics.google.columnIndex")}</th>
                <th scope="col">{t("diagnostics.google.columnErrors")}</th>
                <th scope="col">{t("diagnostics.google.columnWarnings")}</th>
                <th scope="col">{t("diagnostics.google.columnSubmitted")}</th>
              </tr>
            </thead>
            <tbody>
              {sitemapsReport.rows.map((row, index) => (
                <tr key={`${row.path ?? "sitemap"}-${index}`}>
                  <td>
                    <code>{row.path ?? t("common.notAvailable")}</code>
                  </td>
                  <td>{row.type ?? t("common.notAvailable")}</td>
                  <td>
                    {row.isSitemapsIndex === null
                      ? t("common.notAvailable")
                      : row.isSitemapsIndex
                        ? t("common.yes")
                        : t("common.no")}
                  </td>
                  <td>{formatNumber(row.errors, locale)}</td>
                  <td>{formatNumber(row.warnings, locale)}</td>
                  <td>
                    {contentsText(
                      row.contents,
                      locale,
                      t("common.notAvailable"),
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {!sitemaps.loading && sitemapsReport && !sitemapsReport.rows.length ? (
          <EmptyReport
            reason={sitemapsEmpty ?? "provider_returned_no_rows"}
            title={t("diagnostics.google.sitemapsEmptyTitle")}
            hint={t("diagnostics.google.sitemapsEmptyHint")}
          />
        ) : null}

        {!sitemaps.loading &&
        sitemapsReport?.sitemapIndex ? (
          <div>
            <h4>{t("diagnostics.google.indexSummary")}</h4>
            <p>
              <code>
                {sitemapsReport.sitemapIndex.path ??
                  t("common.notAvailable")}
              </code>
            </p>
            {sitemapsReport.sitemapIndex.contents.length ? (
              <ul className="diagnostics-list">
                {sitemapsReport.sitemapIndex.contents.map(
                  (content, index) => (
                    <li key={`${content.type ?? "type"}-${index}`}>
                      {content.type ?? t("common.notAvailable")}:{" "}
                      {formatNumber(content.submitted, locale)}
                    </li>
                  ),
                )}
              </ul>
            ) : (
              <p className="muted small">
                {t("diagnostics.google.indexContentsMissing")}
              </p>
            )}
          </div>
        ) : null}

        {!sitemaps.loading && !sitemapsReport && !sitemaps.error && !blocked ? (
          <p className="muted small">{t("diagnostics.google.sitemapsIdle")}</p>
        ) : null}

        {sitemapsReport ? <MetaNotes meta={sitemapsReport.meta} /> : null}
        <Warnings items={sitemaps.warnings} />
      </Section>
    </>
  );
});
