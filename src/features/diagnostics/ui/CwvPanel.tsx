import { observer } from "mobx-react-lite";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n } from "@/shared/i18n";
import { formatNumber, formatPercent } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { Loading } from "@/shared/ui/Loading";
import { Select } from "@/shared/ui/Select";
import { Table } from "@/shared/ui/Table";
import { emptyReason } from "../model/types";
import type { CwvCategory } from "../model/DiagnosticsStore";
import {
  EmptyReport,
  ErrorNotice,
  Fact,
  MetaNotes,
  Section,
  Warnings,
} from "./shared";
const CATEGORIES: Array<{
  id: CwvCategory;
  key:
    | "diagnostics.cwv.category.performance"
    | "diagnostics.cwv.category.seo"
    | "diagnostics.cwv.category.accessibility"
    | "diagnostics.cwv.category.bestPractices";
}> = [
  { id: "performance", key: "diagnostics.cwv.category.performance" },
  { id: "seo", key: "diagnostics.cwv.category.seo" },
  { id: "accessibility", key: "diagnostics.cwv.category.accessibility" },
  { id: "best-practices", key: "diagnostics.cwv.category.bestPractices" },
];

function savingsText(
  ms: number | null,
  bytes: number | null,
  locale: string,
): string {
  const parts: string[] = [];
  if (ms !== null) {
    parts.push(`${formatNumber(ms, locale)} ms`);
  }
  if (bytes !== null) {
    parts.push(`${formatNumber(bytes, locale)} B`);
  }
  return parts.length ? parts.join(" / ") : "—";
}

export const CwvPanel = observer(function CwvPanel() {
  const { t, locale } = useI18n();
  const { engine, diagnostics: store } = useRootStore();
  const configPath = engine.status?.configPath ?? null;
  const blocked = engine.offline || engine.loading || !configPath;

  const audits = store.cwvAudits;
  const history = store.cwvHistory;
  const auditsReport = audits.report;
  const historyReport = history.report;
  const historyEmpty = historyReport ? emptyReason(historyReport.meta) : null;

  return (
    <>
      <Section
        id="diagnostics-cwv-audits"
        title={t("diagnostics.cwv.auditsTitle")}
        hint={t("diagnostics.cwv.auditsHint")}
        actions={
          <>
            <Badge tone="neutral">{t("diagnostics.readOnly")}</Badge>
            <Button
              variant="secondary"
              loading={audits.loading}
              disabled={blocked || audits.loading}
              onClick={() => void store.loadCwvAudits(configPath)}
            >
              {audits.loading
                ? t("diagnostics.cwv.running")
                : t("diagnostics.cwv.run")}
            </Button>
          </>
        }
      >
        <div className="form-grid diagnostics-form">
          <Field
            id="diagnostics-cwv-url"
            label={t("diagnostics.cwv.urlLabel")}
            hint={t("diagnostics.cwv.urlHint")}
          >
            <Input
              id="diagnostics-cwv-url"
              value={store.cwvUrl}
              spellCheck={false}
              autoComplete="off"
              placeholder="https://example.com/"
              onChange={(event) => {
                store.cwvUrl = event.target.value;
              }}
            />
          </Field>
          <Field
            id="diagnostics-cwv-strategy"
            label={t("diagnostics.cwv.strategyLabel")}
            hint={t("diagnostics.cwv.strategyHint")}
          >
            <Select
              id="diagnostics-cwv-strategy"
              value={store.cwvStrategy}
              onChange={(event) => {
                store.cwvStrategy = event.target.value as
                  | "mobile"
                  | "desktop";
              }}
            >
              <option value="mobile">{t("diagnostics.cwv.mobile")}</option>
              <option value="desktop">{t("diagnostics.cwv.desktop")}</option>
            </Select>
          </Field>
        </div>

        <fieldset className="diagnostics-categories">
          <legend className="muted small">
            {t("diagnostics.cwv.categoriesLabel")}
          </legend>
          {CATEGORIES.map((category) => (
            <label
              className="diagnostics-check"
              key={category.id}
              htmlFor={`diagnostics-cwv-category-${category.id}`}
            >
              <input
                id={`diagnostics-cwv-category-${category.id}`}
                type="checkbox"
                checked={store.cwvCategories.includes(category.id)}
                onChange={(event) =>
                  store.toggleCwvCategory(category.id, event.target.checked)
                }
              />
              <span>{t(category.key)}</span>
            </label>
          ))}
        </fieldset>
        <p className="muted small">{t("diagnostics.cwv.labNote")}</p>

        {audits.error ? (
          <ErrorNotice
            title={t("diagnostics.cwv.auditsError")}
            error={audits.error}
            onRetry={() => void store.loadCwvAudits(configPath)}
          />
        ) : null}
        {audits.loading ? (
          <Loading label={t("diagnostics.cwv.running")} />
        ) : null}

        {!audits.loading && auditsReport ? (
          <>
            <div className="diagnostics-facts">
              {auditsReport.categories.map((category) => (
                <Fact
                  key={category.category ?? "category"}
                  label={category.category ?? t("common.notAvailable")}
                  value={formatPercent(category.score, locale, 0)}
                />
              ))}
              {auditsReport.meta.finalUrl ? (
                <Fact
                  label={t("diagnostics.cwv.finalUrl")}
                  value={<code>{auditsReport.meta.finalUrl}</code>}
                />
              ) : null}
              {auditsReport.meta.analysisUtcTimestamp ? (
                <Fact
                  label={t("diagnostics.cwv.analysisTime")}
                  value={auditsReport.meta.analysisUtcTimestamp}
                />
              ) : null}
            </div>

            {auditsReport.audits.length ? (
              <Table caption={t("diagnostics.cwv.auditsTitle")}>
                <thead>
                  <tr>
                    <th scope="col">{t("diagnostics.cwv.columnAudit")}</th>
                    <th scope="col">{t("diagnostics.cwv.columnScore")}</th>
                    <th scope="col">{t("diagnostics.cwv.columnValue")}</th>
                    <th scope="col">{t("diagnostics.cwv.columnSavings")}</th>
                    <th scope="col">{t("diagnostics.cwv.columnItems")}</th>
                  </tr>
                </thead>
                <tbody>
                  {auditsReport.audits.map((row, index) => (
                    <tr key={`${row.id ?? "audit"}-${index}`}>
                      <td title={row.description ?? undefined}>
                        <strong>{row.title ?? row.id ?? t("common.notAvailable")}</strong>
                        {row.id ? (
                          <div className="muted small">
                            <code>{row.id}</code>
                          </div>
                        ) : null}
                      </td>
                      <td>{formatPercent(row.score, locale, 0)}</td>
                      <td>{row.displayValue ?? "—"}</td>
                      <td>
                        {savingsText(
                          row.overallSavingsMs,
                          row.overallSavingsBytes,
                          locale,
                        )}
                      </td>
                      <td>{formatNumber(row.itemsCount, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState
                title={t("diagnostics.cwv.auditsEmptyTitle")}
                hint={t("diagnostics.cwv.auditsEmptyHint")}
              />
            )}
            <MetaNotes meta={auditsReport.meta} />
            <Warnings items={audits.warnings} />
          </>
        ) : null}

        {!audits.loading && !auditsReport && !audits.error && !blocked ? (
          <p className="muted small">{t("diagnostics.cwv.auditsIdle")}</p>
        ) : null}
      </Section>

      <Section
        id="diagnostics-cwv-history"
        title={t("diagnostics.cwv.historyTitle")}
        hint={t("diagnostics.cwv.historyHint")}
        actions={
          <>
            <Badge tone="neutral">{t("diagnostics.readOnly")}</Badge>
            <Button
              variant="secondary"
              loading={history.loading}
              disabled={blocked || history.loading}
              onClick={() => void store.loadCwvHistory(configPath)}
            >
              {history.loading
                ? t("diagnostics.loading")
                : t("diagnostics.load")}
            </Button>
          </>
        }
      >
        <div className="form-grid diagnostics-form">
          <Field
            id="diagnostics-cwv-target-mode"
            label={t("diagnostics.cwv.targetModeLabel")}
            hint={t("diagnostics.cwv.targetModeHint")}
          >
            <Select
              id="diagnostics-cwv-target-mode"
              value={store.cwvTargetMode}
              onChange={(event) => {
                store.cwvTargetMode = event.target.value as "url" | "origin";
              }}
            >
              <option value="url">{t("diagnostics.cwv.modeUrl")}</option>
              <option value="origin">{t("diagnostics.cwv.modeOrigin")}</option>
            </Select>
          </Field>
          <Field
            id="diagnostics-cwv-history-target"
            label={
              store.cwvTargetMode === "url"
                ? t("diagnostics.cwv.urlLabel")
                : t("diagnostics.cwv.originLabel")
            }
            hint={t("diagnostics.cwv.historyTargetHint")}
          >
            <Input
              id="diagnostics-cwv-history-target"
              value={
                store.cwvTargetMode === "url"
                  ? store.cwvHistoryUrl
                  : store.cwvHistoryOrigin
              }
              spellCheck={false}
              autoComplete="off"
              placeholder={
                store.cwvTargetMode === "url"
                  ? "https://example.com/page"
                  : "https://example.com"
              }
              onChange={(event) => {
                if (store.cwvTargetMode === "url") {
                  store.cwvHistoryUrl = event.target.value;
                } else {
                  store.cwvHistoryOrigin = event.target.value;
                }
              }}
            />
          </Field>
          <Field
            id="diagnostics-cwv-device"
            label={t("diagnostics.cwv.deviceLabel")}
            hint={t("diagnostics.cwv.deviceHint")}
          >
            <Select
              id="diagnostics-cwv-device"
              value={store.cwvDevice}
              onChange={(event) => {
                store.cwvDevice = event.target.value as
                  | "all"
                  | "phone"
                  | "desktop"
                  | "tablet";
              }}
            >
              <option value="all">{t("diagnostics.cwv.deviceAll")}</option>
              <option value="phone">{t("diagnostics.cwv.phone")}</option>
              <option value="desktop">{t("diagnostics.cwv.desktop")}</option>
              <option value="tablet">{t("diagnostics.cwv.tablet")}</option>
            </Select>
          </Field>
          <Field
            id="diagnostics-cwv-weeks"
            label={t("diagnostics.cwv.weeksLabel")}
            hint={t("diagnostics.cwv.weeksHint")}
          >
            <Input
              id="diagnostics-cwv-weeks"
              type="number"
              min={1}
              max={40}
              value={store.cwvWeeks}
              onChange={(event) => {
                store.cwvWeeks = Number(event.target.value);
              }}
            />
          </Field>
        </div>
        <p className="muted small">{t("diagnostics.cwv.historyNote")}</p>

        {history.error ? (
          <ErrorNotice
            title={t("diagnostics.cwv.historyError")}
            error={history.error}
            onRetry={() => void store.loadCwvHistory(configPath)}
          />
        ) : null}
        {history.loading ? (
          <Loading label={t("diagnostics.loading")} />
        ) : null}

        {!history.loading && historyReport && historyReport.periods.length ? (
          <>
            <Table caption={t("diagnostics.cwv.historyTitle")}>
              <thead>
                <tr>
                  <th scope="col">{t("diagnostics.cwv.columnPeriod")}</th>
                  <th scope="col">{t("diagnostics.cwv.columnDevice")}</th>
                  <th scope="col">LCP</th>
                  <th scope="col">INP</th>
                  <th scope="col">CLS</th>
                  <th scope="col">FCP</th>
                  <th scope="col">TTFB</th>
                  <th scope="col">FID</th>
                </tr>
              </thead>
              <tbody>
                {historyReport.periods.map((period, index) => (
                  <tr key={`${period.firstDate ?? "from"}-${index}`}>
                    <td>
                      {period.firstDate ?? "—"} … {period.lastDate ?? "—"}
                    </td>
                    <td>{period.device ?? t("diagnostics.cwv.deviceAll")}</td>
                    <td>{formatNumber(period.lcp, locale)}</td>
                    <td>{formatNumber(period.inp, locale)}</td>
                    <td>{formatNumber(period.cls, locale, 3)}</td>
                    <td>{formatNumber(period.fcp, locale)}</td>
                    <td>{formatNumber(period.ttfb, locale)}</td>
                    <td>{formatNumber(period.fid, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <MetaNotes meta={historyReport.meta} />
            <Warnings items={history.warnings} />
          </>
        ) : null}

        {!history.loading && historyReport && !historyReport.periods.length ? (
          historyEmpty ? (
            <EmptyReport
              reason={historyEmpty}
              title={t("diagnostics.cwv.historyEmptyTitle")}
              hint={t("diagnostics.cwv.historyEmptyHint")}
            />
          ) : (
            <EmptyState
              title={t("diagnostics.cwv.historyEmptyTitle")}
              hint={t("diagnostics.cwv.historyEmptyHint")}
            />
          )
        ) : null}

        {!history.loading && !historyReport && !history.error && !blocked ? (
          <p className="muted small">{t("diagnostics.cwv.historyIdle")}</p>
        ) : null}
      </Section>
    </>
  );
});
