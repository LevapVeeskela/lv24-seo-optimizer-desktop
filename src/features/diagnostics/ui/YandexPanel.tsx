import { observer } from "mobx-react-lite";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n } from "@/shared/i18n";
import { formatDateTime, formatNumber } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { Loading } from "@/shared/ui/Loading";
import { Table } from "@/shared/ui/Table";
import {
  ErrorNotice,
  Fact,
  MetaNotes,
  Section,
  Warnings,
} from "./shared";

export const YandexPanel = observer(function YandexPanel() {
  const { t, locale } = useI18n();
  const { engine, diagnostics: store } = useRootStore();
  const configPath = engine.status?.configPath ?? null;
  const blocked = engine.offline || engine.loading || !configPath;

  const indexing = store.yandexIndexing;
  const sitemaps = store.yandexSitemaps;
  const queue = store.yandexQueue;
  const indexingReport = indexing.report;
  const sitemapsReport = sitemaps.report;
  const queueReport = queue.report;

  return (
    <>
      <Section
        id="diagnostics-yandex-indexing"
        title={t("diagnostics.yandex.indexingTitle")}
        hint={t("diagnostics.yandex.indexingHint")}
        actions={
          <>
            <Badge tone="neutral">{t("diagnostics.readOnly")}</Badge>
            <Button
              variant="secondary"
              loading={indexing.loading}
              disabled={blocked || indexing.loading}
              onClick={() => void store.loadYandexIndexing(configPath)}
            >
              {indexing.loading
                ? t("diagnostics.loading")
                : t("diagnostics.load")}
            </Button>
          </>
        }
      >
        <div className="form-grid diagnostics-form">
          <Field
            id="diagnostics-yandex-from"
            label={t("diagnostics.yandex.fromLabel")}
            hint={t("diagnostics.yandex.dateHint")}
          >
            <Input
              id="diagnostics-yandex-from"
              type="date"
              value={store.yandexFrom}
              onChange={(event) => {
                store.yandexFrom = event.target.value;
              }}
            />
          </Field>
          <Field
            id="diagnostics-yandex-to"
            label={t("diagnostics.yandex.toLabel")}
            hint={t("diagnostics.yandex.dateHint")}
          >
            <Input
              id="diagnostics-yandex-to"
              type="date"
              value={store.yandexTo}
              onChange={(event) => {
                store.yandexTo = event.target.value;
              }}
            />
          </Field>
        </div>

        {indexing.error ? (
          <ErrorNotice
            title={t("diagnostics.yandex.indexingError")}
            error={indexing.error}
            onRetry={() => void store.loadYandexIndexing(configPath)}
          />
        ) : null}
        {indexing.loading ? (
          <Loading label={t("diagnostics.loading")} />
        ) : null}

        {!indexing.loading && indexingReport?.summary ? (
          <div className="diagnostics-facts">
            <Fact
              label={t("diagnostics.yandex.sqi")}
              value={formatNumber(indexingReport.summary.sqi, locale, 1)}
            />
            <Fact
              label={t("diagnostics.yandex.pagesInSearch")}
              value={formatNumber(
                indexingReport.summary.pagesInSearch,
                locale,
              )}
            />
            <Fact
              label={t("diagnostics.yandex.pagesExcluded")}
              value={formatNumber(
                indexingReport.summary.pagesExcluded,
                locale,
              )}
            />
            <Fact
              label={t("diagnostics.yandex.http2xx")}
              value={formatNumber(indexingReport.summary.http2xx, locale)}
            />
            <Fact
              label={t("diagnostics.yandex.siteProblems")}
              value={formatNumber(indexingReport.summary.siteProblems, locale)}
            />
          </div>
        ) : null}

        {!indexing.loading &&
        indexingReport &&
        indexingReport.events.length ? (
          <div>
            <h4>{t("diagnostics.yandex.eventsTitle")}</h4>
            <Table caption={t("diagnostics.yandex.eventsTitle")}>
              <thead>
                <tr>
                  <th scope="col">{t("diagnostics.yandex.columnDate")}</th>
                  <th scope="col">{t("diagnostics.yandex.columnAppeared")}</th>
                  <th scope="col">{t("diagnostics.yandex.columnRemoved")}</th>
                </tr>
              </thead>
              <tbody>
                {indexingReport.events.map((row, index) => (
                  <tr key={`${row.date ?? "date"}-${index}`}>
                    <td>{row.date ?? t("common.notAvailable")}</td>
                    <td>{formatNumber(row.appeared, locale)}</td>
                    <td>{formatNumber(row.removed, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : null}

        {!indexing.loading &&
        indexingReport &&
        indexingReport.history.length ? (
          <div>
            <h4>{t("diagnostics.yandex.historyTitle")}</h4>
            <Table caption={t("diagnostics.yandex.historyTitle")}>
              <thead>
                <tr>
                  <th scope="col">{t("diagnostics.yandex.columnDate")}</th>
                  <th scope="col">{t("diagnostics.yandex.column2xx")}</th>
                  <th scope="col">{t("diagnostics.yandex.column3xx")}</th>
                  <th scope="col">{t("diagnostics.yandex.column4xx")}</th>
                  <th scope="col">{t("diagnostics.yandex.column5xx")}</th>
                  <th scope="col">{t("diagnostics.yandex.columnOther")}</th>
                </tr>
              </thead>
              <tbody>
                {indexingReport.history.map((row, index) => (
                  <tr key={`${row.date ?? "date"}-${index}`}>
                    <td>{row.date ?? t("common.notAvailable")}</td>
                    <td>{formatNumber(row.http2xx, locale)}</td>
                    <td>{formatNumber(row.http3xx, locale)}</td>
                    <td>{formatNumber(row.http4xx, locale)}</td>
                    <td>{formatNumber(row.http5xx, locale)}</td>
                    <td>{formatNumber(row.other, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : null}

        {!indexing.loading &&
        indexingReport &&
        !indexingReport.events.length &&
        !indexingReport.history.length ? (
          <EmptyState
            title={t("diagnostics.yandex.indexingEmptyTitle")}
            hint={t("diagnostics.yandex.indexingEmptyHint")}
          />
        ) : null}

        {!indexing.loading && !indexingReport && !indexing.error && !blocked ? (
          <p className="muted small">
            {t("diagnostics.yandex.indexingIdle")}
          </p>
        ) : null}

        {indexingReport ? <MetaNotes meta={indexingReport.meta} /> : null}
        <Warnings items={indexing.warnings} />
      </Section>

      <Section
        id="diagnostics-yandex-sitemaps"
        title={t("diagnostics.yandex.sitemapsTitle")}
        hint={t("diagnostics.yandex.sitemapsHint")}
        actions={
          <>
            <Badge tone="neutral">{t("diagnostics.readOnly")}</Badge>
            <Button
              variant="secondary"
              loading={sitemaps.loading}
              disabled={blocked || sitemaps.loading}
              onClick={() => void store.loadYandexSitemaps(configPath)}
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
            id="diagnostics-yandex-parent"
            label={t("diagnostics.yandex.parentLabel")}
            hint={t("diagnostics.yandex.parentHint")}
          >
            <Input
              id="diagnostics-yandex-parent"
              value={store.yandexParentId}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                store.yandexParentId = event.target.value;
              }}
            />
          </Field>
          <Field
            id="diagnostics-yandex-limit"
            label={t("diagnostics.yandex.limitLabel")}
            hint={t("diagnostics.yandex.limitHint")}
          >
            <Input
              id="diagnostics-yandex-limit"
              type="number"
              min={1}
              max={500}
              value={store.yandexLimit}
              onChange={(event) => {
                store.yandexLimit = Number(event.target.value);
              }}
            />
          </Field>
        </div>

        {sitemaps.error ? (
          <ErrorNotice
            title={t("diagnostics.yandex.sitemapsError")}
            error={sitemaps.error}
            onRetry={() => void store.loadYandexSitemaps(configPath)}
          />
        ) : null}
        {sitemaps.loading ? (
          <Loading label={t("diagnostics.loading")} />
        ) : null}

        {!sitemaps.loading && sitemapsReport && sitemapsReport.rows.length ? (
          <Table caption={t("diagnostics.yandex.sitemapsTitle")}>
            <thead>
              <tr>
                <th scope="col">{t("diagnostics.yandex.columnUrl")}</th>
                <th scope="col">{t("diagnostics.yandex.columnUrls")}</th>
                <th scope="col">{t("diagnostics.yandex.columnErrors")}</th>
                <th scope="col">{t("diagnostics.yandex.columnLastAccess")}</th>
                <th scope="col">{t("diagnostics.yandex.columnChildren")}</th>
                <th scope="col">{t("diagnostics.yandex.columnType")}</th>
              </tr>
            </thead>
            <tbody>
              {sitemapsReport.rows.map((row, index) => (
                <tr key={`${row.sitemapId ?? row.sitemapUrl ?? "sitemap"}-${index}`}>
                  <td>
                    <code>
                      {row.sitemapUrl ?? t("common.notAvailable")}
                    </code>
                  </td>
                  <td>{formatNumber(row.urlsCount, locale)}</td>
                  <td>{formatNumber(row.errorsCount, locale)}</td>
                  <td>
                    {row.lastAccessDate
                      ? formatDateTime(row.lastAccessDate, locale)
                      : t("common.notAvailable")}
                  </td>
                  <td>{formatNumber(row.childrenCount, locale)}</td>
                  <td>{row.sitemapType ?? t("common.notAvailable")}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {!sitemaps.loading &&
        sitemapsReport &&
        !sitemapsReport.rows.length ? (
          <EmptyState
            title={t("diagnostics.yandex.sitemapsEmptyTitle")}
            hint={t("diagnostics.yandex.sitemapsEmptyHint")}
          />
        ) : null}

        {!sitemaps.loading && !sitemapsReport && !sitemaps.error && !blocked ? (
          <p className="muted small">{t("diagnostics.yandex.sitemapsIdle")}</p>
        ) : null}

        {sitemapsReport ? <MetaNotes meta={sitemapsReport.meta} /> : null}
        <Warnings items={sitemaps.warnings} />
      </Section>

      <Section
        id="diagnostics-yandex-queue"
        title={t("diagnostics.yandex.queueTitle")}
        hint={t("diagnostics.yandex.queueHint")}
        actions={
          <>
            <Badge tone="neutral">{t("diagnostics.readOnly")}</Badge>
            <Button
              variant="secondary"
              loading={queue.loading}
              disabled={blocked || queue.loading}
              onClick={() => void store.loadYandexQueue(configPath)}
            >
              {queue.loading
                ? t("diagnostics.loading")
                : t("diagnostics.load")}
            </Button>
          </>
        }
      >
        <div className="form-grid diagnostics-form">
          <Field
            id="diagnostics-yandex-queue-limit"
            label={t("diagnostics.yandex.limitLabel")}
            hint={t("diagnostics.yandex.limitHint")}
          >
            <Input
              id="diagnostics-yandex-queue-limit"
              type="number"
              min={1}
              max={500}
              value={store.yandexLimit}
              onChange={(event) => {
                store.yandexLimit = Number(event.target.value);
              }}
            />
          </Field>
          <Field
            id="diagnostics-yandex-offset"
            label={t("diagnostics.yandex.offsetLabel")}
            hint={t("diagnostics.yandex.offsetHint")}
          >
            <Input
              id="diagnostics-yandex-offset"
              type="number"
              min={0}
              value={store.yandexOffset}
              onChange={(event) => {
                store.yandexOffset = Number(event.target.value);
              }}
            />
          </Field>
        </div>
        <p className="muted small">{t("diagnostics.yandex.queueWindowHint")}</p>

        {queue.error ? (
          <ErrorNotice
            title={t("diagnostics.yandex.queueError")}
            error={queue.error}
            onRetry={() => void store.loadYandexQueue(configPath)}
          />
        ) : null}
        {queue.loading ? (
          <Loading label={t("diagnostics.loading")} />
        ) : null}

        {!queue.loading && queueReport && queueReport.rows.length ? (
          <Table caption={t("diagnostics.yandex.queueTitle")}>
            <thead>
              <tr>
                <th scope="col">{t("diagnostics.yandex.columnTask")}</th>
                <th scope="col">{t("diagnostics.yandex.columnUrl")}</th>
                <th scope="col">{t("diagnostics.yandex.columnState")}</th>
                <th scope="col">{t("diagnostics.yandex.columnAdded")}</th>
              </tr>
            </thead>
            <tbody>
              {queueReport.rows.map((row, index) => (
                <tr key={`${row.taskId ?? "task"}-${index}`}>
                  <td>
                    <code>{row.taskId ?? t("common.notAvailable")}</code>
                  </td>
                  <td>
                    <code>{row.url ?? t("common.notAvailable")}</code>
                  </td>
                  <td>{row.state ?? t("common.notAvailable")}</td>
                  <td>
                    {row.addedTime
                      ? formatDateTime(row.addedTime, locale)
                      : t("common.notAvailable")}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {!queue.loading && queueReport && !queueReport.rows.length ? (
          <EmptyState
            title={t("diagnostics.yandex.queueEmptyTitle")}
            hint={t("diagnostics.yandex.queueEmptyHint")}
          />
        ) : null}

        {!queue.loading && !queueReport && !queue.error && !blocked ? (
          <p className="muted small">{t("diagnostics.yandex.queueIdle")}</p>
        ) : null}

        {queueReport ? <MetaNotes meta={queueReport.meta} /> : null}
        <Warnings items={queue.warnings} />
      </Section>
    </>
  );
});
