import { useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { useRootStore } from "@/app/providers/StoreProvider";
import {
  LOG_BOTS,
  LOG_FILTERS_DEFAULT,
  effectiveLogFilters,
  filterLogRows,
  logFacets,
  logsLimitations,
  pickLogFile,
  sortLogRows,
  type LogBot,
  type LogFilters,
} from "@/entities/logs";
import {
  LogsExportPanel,
  LogsFilterBar,
  LogsTable,
  LogsWasteCard,
} from "@/features/logs";
import { useI18n } from "@/shared/i18n";
import { appErrorText } from "@/shared/lib/errors";
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
import "./logs.css";

/** DOM budget: a multi-month log can roll up into thousands of rows. */
const VISIBLE_LIMIT = 500;

const BOT_LABEL_KEYS = {
  googlebot: "logs.bot.googlebot",
  yandexbot: "logs.bot.yandexbot",
  bingbot: "logs.bot.bingbot",
  other: "logs.bot.other",
} as const;

export const LogsPage = observer(function LogsPage() {
  const { t, locale } = useI18n();
  const { engine, logs: store } = useRootStore();
  const [filters, setFilters] = useState<LogFilters>({ ...LOG_FILTERS_DEFAULT });
  const [pickError, setPickError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const exportDir = engine.status?.paths?.exportDir ?? null;
  const blocked = engine.offline || engine.loading;
  const result = store.result;
  const rows = result?.bot_daily ?? [];
  const facets = useMemo(() => logFacets(rows), [rows]);
  const activeFilters = effectiveLogFilters(filters, facets);
  const visibleRows = useMemo(
    () => sortLogRows(filterLogRows(rows, activeFilters)),
    [rows, activeFilters.bot, activeFilters.status],
  );
  const displayedRows = visibleRows.slice(0, VISIBLE_LIMIT);
  const limitations = logsLimitations(store.meta);
  const warnings = [
    ...new Set(store.warnings.filter((item) => item.trim() !== "")),
  ];

  const pick = async () => {
    setPicking(true);
    setPickError(null);
    try {
      const path = await pickLogFile();
      if (path) {
        store.setFile(path);
        setFilters({ ...LOG_FILTERS_DEFAULT });
      }
    } catch {
      setPickError(t("logs.pickFailed"));
    } finally {
      setPicking(false);
    }
  };

  const submit = async () => {
    if (blocked || store.loading || !store.file) {
      return;
    }
    setFilters({ ...LOG_FILTERS_DEFAULT });
    await store.run();
  };

  return (
    <section className="page logs-page">
      <header className="page-header">
        <div>
          <h1>{t("logs.title")}</h1>
          <p className="muted">{t("logs.subtitle")}</p>
        </div>
        {store.lastRunAt ? (
          <p className="muted small">
            {t("logs.lastRun")}: {formatDateTime(store.lastRunAt, locale)}
          </p>
        ) : null}
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
          <strong>{t("logs.offlineTitle")}</strong>
          <span>{t("logs.offlineHint")}</span>
        </Notice>
      ) : null}

      <Card>
        <div className="form-grid">
          <Field id="logs-file" label={t("logs.fileLabel")} hint={t("logs.fileHint")}>
            <div className="logs-file-row">
              <Input
                id="logs-file"
                readOnly
                value={store.file ?? ""}
                placeholder={t("logs.noFile")}
                aria-describedby="logs-file-hint"
              />
              <Button
                variant="secondary"
                loading={picking}
                disabled={blocked || picking}
                onClick={() => void pick()}
              >
                {store.file ? t("logs.changeFile") : t("logs.pickFile")}
              </Button>
            </div>
          </Field>

          <Field id="logs-bot" label={t("logs.botLabel")} hint={t("logs.botHint")}>
            <Select
              id="logs-bot"
              value={store.bot ?? ""}
              disabled={blocked || store.loading}
              onChange={(event) =>
                store.setBot((event.target.value || null) as LogBot | null)
              }
            >
              <option value="">{t("logs.botAll")}</option>
              {LOG_BOTS.map((bot) => (
                <option key={bot} value={bot}>
                  {t(BOT_LABEL_KEYS[bot])}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {pickError ? (
          <Notice variant="error">
            <span>{pickError}</span>
          </Notice>
        ) : null}

        <div className="form-actions">
          <Button
            variant="primary"
            loading={store.loading}
            disabled={blocked || store.loading || !store.file}
            onClick={() => void submit()}
          >
            {store.loading ? t("logs.running") : t("logs.run")}
          </Button>
        </div>
      </Card>

      {store.state === "cancelled" ? (
        <Notice
          variant="info"
          action={
            <Button
              variant="secondary"
              disabled={blocked || store.loading || !store.file}
              onClick={() => void submit()}
            >
              {t("common.retry")}
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
              disabled={blocked || store.loading || !store.file}
              onClick={() => void submit()}
            >
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("logs.errorTitle")}</strong>
          <span>{appErrorText(store.error)}</span>
          <code className="callback">
            {t("integrations.errorCode", { code: store.error.code })}
          </code>
        </Notice>
      ) : null}

      {store.loading && !result ? <Loading label={t("logs.loading")} /> : null}

      {!result && !store.loading && !store.error && store.state !== "cancelled" ? (
        <Card>
          <EmptyState
            title={t("logs.emptyTitle")}
            hint={t("logs.emptyHint")}
          />
        </Card>
      ) : null}

      {result ? (
        <>
          <Card>
            <div className="card-header">
              <div>
                <h2>{t("logs.summaryTitle")}</h2>
                <p className="muted small">{t("logs.summaryHint")}</p>
              </div>
              {store.meta.truncated === true ? (
                <Badge tone="warning">{t("runStatus.truncated")}</Badge>
              ) : null}
            </div>

            <div className="logs-facts">
              <div className="logs-fact">
                <span className="muted small">{t("logs.totalLines")}</span>
                <strong>{formatNumber(result.total_lines, locale)}</strong>
              </div>
              <div className="logs-fact">
                <span className="muted small">{t("logs.parsedLines")}</span>
                <strong>{formatNumber(result.parsed_lines, locale)}</strong>
              </div>
              <div className="logs-fact">
                <span className="muted small">{t("logs.skippedLines")}</span>
                <strong>{formatNumber(result.skipped_lines, locale)}</strong>
              </div>
            </div>

            <p className="muted small logs-source">
              {store.file ?? store.meta.file ? (
                <span>
                  {t("logs.fileMeta")}:{" "}
                  <code>{store.file ?? store.meta.file}</code>
                </span>
              ) : null}
              {typeof store.meta.size_bytes === "number" ? (
                <span>
                  {t("logs.sizeMeta")}:{" "}
                  {formatNumber(store.meta.size_bytes, locale)}
                </span>
              ) : null}
            </p>
          </Card>

          <Notice variant="info">
            <strong>{t("logs.uaTitle")}</strong>
            <span>{t("logs.uaHint")}</span>
          </Notice>

          <LogsWasteCard waste={result.crawl_waste} />

          <Card>
            <div className="card-header">
              <div>
                <h2>{t("logs.tableTitle")}</h2>
                <p className="muted small">{t("logs.tableHint")}</p>
              </div>
              <p className="muted small">
                {t("logs.rowsShown", {
                  shown: displayedRows.length,
                  total: rows.length,
                })}
              </p>
            </div>

            {rows.length === 0 ? (
              <EmptyState title={t("logs.noRows")} hint={t("logs.noRowsHint")} />
            ) : (
              <>
                <LogsFilterBar
                  facets={facets}
                  filters={activeFilters}
                  onChange={setFilters}
                  onReset={() => setFilters({ ...LOG_FILTERS_DEFAULT })}
                />

                {visibleRows.length === 0 ? (
                  <EmptyState
                    title={t("logs.filteredEmptyTitle")}
                    hint={t("logs.filteredEmptyHint")}
                    action={
                      <Button
                        variant="secondary"
                        onClick={() => setFilters({ ...LOG_FILTERS_DEFAULT })}
                      >
                        {t("logs.filterReset")}
                      </Button>
                    }
                  />
                ) : (
                  <LogsTable rows={displayedRows} />
                )}
              </>
            )}
          </Card>

          {limitations.length ? (
            <Card>
              <h3>{t("logs.limitations")}</h3>
              <ul className="report-notes">
                {limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {warnings.length ? (
            <Card>
              <h3>{t("logs.warnings")}</h3>
              <ul className="report-notes">
                {warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <LogsExportPanel store={store} exportDir={exportDir} />
        </>
      ) : null}
    </section>
  );
});
