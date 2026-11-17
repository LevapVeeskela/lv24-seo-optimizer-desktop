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
import { Notice } from "@/shared/ui/Notice";
import { Select } from "@/shared/ui/Select";
import { Table } from "@/shared/ui/Table";
import type { MetrikaTableRow } from "../model/types";
import {
  ErrorNotice,
  Fact,
  MetaNotes,
  Section,
  Warnings,
} from "./shared";

function durationText(
  value: number | null,
  locale: string,
): string {
  return value === null ? "—" : `${formatNumber(value, locale, 1)} s`;
}

function MetrikaTable({
  caption,
  label,
  rows,
  locale,
}: {
  caption: string;
  label: string;
  rows: MetrikaTableRow[];
  locale: string;
}) {
  const { t } = useI18n();
  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <th scope="col">{label}</th>
          <th scope="col">{t("diagnostics.metrika.columnVisits")}</th>
          <th scope="col">{t("diagnostics.metrika.columnUsers")}</th>
          <th scope="col">{t("diagnostics.metrika.columnBounce")}</th>
          <th scope="col">{t("diagnostics.metrika.columnDuration")}</th>
          <th scope="col">{t("diagnostics.metrika.columnPageviews")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.label ?? "row"}-${index}`}>
            <td>{row.label ?? t("common.notAvailable")}</td>
            <td>{formatNumber(row.visits, locale)}</td>
            <td>{formatNumber(row.users, locale)}</td>
            <td>{formatPercent(row.bounceRate, locale, 1)}</td>
            <td>{durationText(row.avgVisitDurationSeconds, locale)}</td>
            <td>{formatNumber(row.pageviews, locale)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export const MetrikaPanel = observer(function MetrikaPanel() {
  const { t, locale } = useI18n();
  const { engine, diagnostics: store } = useRootStore();
  const configPath = engine.status?.configPath ?? null;
  const blocked = engine.offline || engine.loading || !configPath;

  const pages = store.metrikaPages;
  const goals = store.metrikaGoals;
  const devices = store.metrikaDevices;
  const countries = store.metrikaCountries;
  const engagement = store.metrikaEngagement;
  const bytime = store.metrikaBytime;

  const pagesReport = pages.report;
  const goalsReport = goals.report;
  const devicesReport = devices.report;
  const countriesReport = countries.report;
  const engagementReport = engagement.report;
  const bytimeReport = bytime.report;

  const loadButton = (loading: boolean, action: () => void) => (
    <Button
      variant="secondary"
      loading={loading}
      disabled={blocked || loading}
      onClick={action}
    >
      {loading ? t("diagnostics.loading") : t("diagnostics.load")}
    </Button>
  );

  return (
    <>
      <Section
        id="diagnostics-metrika-window"
        title={t("diagnostics.metrika.controlsTitle")}
        hint={t("diagnostics.metrika.controlsHint")}
        actions={<Badge tone="neutral">{t("diagnostics.readOnly")}</Badge>}
      >
        <div className="form-grid diagnostics-form">
          <Field
            id="diagnostics-metrika-days"
            label={t("diagnostics.metrika.daysLabel")}
            hint={t("diagnostics.metrika.daysHint")}
          >
            <Input
              id="diagnostics-metrika-days"
              type="number"
              min={1}
              max={3660}
              value={store.metrikaDays}
              onChange={(event) => {
                store.metrikaDays = Number(event.target.value);
              }}
            />
          </Field>
          <Field
            id="diagnostics-metrika-lag"
            label={t("diagnostics.metrika.lagLabel")}
            hint={t("diagnostics.metrika.lagHint")}
          >
            <Input
              id="diagnostics-metrika-lag"
              type="number"
              min={0}
              max={30}
              value={store.metrikaLagDays}
              onChange={(event) => {
                store.metrikaLagDays = Number(event.target.value);
              }}
            />
          </Field>
          <Field
            id="diagnostics-metrika-limit"
            label={t("diagnostics.metrika.limitLabel")}
            hint={t("diagnostics.metrika.limitHint")}
          >
            <Input
              id="diagnostics-metrika-limit"
              type="number"
              min={1}
              max={500}
              value={store.metrikaLimit}
              onChange={(event) => {
                store.metrikaLimit = Number(event.target.value);
              }}
            />
          </Field>
          <Field
            id="diagnostics-metrika-group"
            label={t("diagnostics.metrika.groupLabel")}
            hint={t("diagnostics.metrika.groupHint")}
          >
            <Select
              id="diagnostics-metrika-group"
              value={store.metrikaGroup}
              onChange={(event) => {
                store.metrikaGroup = event.target.value as
                  | "day"
                  | "week"
                  | "month";
              }}
            >
              <option value="day">{t("diagnostics.metrika.groupDay")}</option>
              <option value="week">{t("diagnostics.metrika.groupWeek")}</option>
              <option value="month">
                {t("diagnostics.metrika.groupMonth")}
              </option>
            </Select>
          </Field>
        </div>
        <p className="muted small">{t("diagnostics.metrika.organicHint")}</p>
      </Section>

      <Section
        id="diagnostics-metrika-pages"
        title={t("diagnostics.metrika.pagesTitle")}
        hint={t("diagnostics.metrika.pagesHint")}
        actions={loadButton(pages.loading, () => void store.loadMetrikaPages(configPath))}
      >
        {pages.error ? (
          <ErrorNotice
            title={t("diagnostics.metrika.pagesError")}
            error={pages.error}
            onRetry={() => void store.loadMetrikaPages(configPath)}
          />
        ) : null}
        {pages.loading ? <Loading label={t("diagnostics.loading")} /> : null}
        {!pages.loading && pagesReport && pagesReport.rows.length ? (
          <MetrikaTable
            caption={t("diagnostics.metrika.pagesTitle")}
            label={t("diagnostics.metrika.columnPage")}
            rows={pagesReport.rows}
            locale={locale}
          />
        ) : null}
        {!pages.loading && pagesReport && !pagesReport.rows.length ? (
          <EmptyState
            title={t("diagnostics.metrika.pagesEmptyTitle")}
            hint={t("diagnostics.metrika.pagesEmptyHint")}
          />
        ) : null}
        {!pages.loading && !pagesReport && !pages.error && !blocked ? (
          <p className="muted small">{t("diagnostics.metrika.pagesIdle")}</p>
        ) : null}
        {pagesReport ? (
          <MetaNotes meta={pagesReport.meta} showSampling />
        ) : null}
        <Warnings items={pages.warnings} />
      </Section>

      <Section
        id="diagnostics-metrika-goals"
        title={t("diagnostics.metrika.goalsTitle")}
        hint={t("diagnostics.metrika.goalsHint")}
        actions={loadButton(goals.loading, () => void store.loadMetrikaGoals(configPath))}
      >
        {goals.error ? (
          <ErrorNotice
            title={t("diagnostics.metrika.goalsError")}
            error={goals.error}
            onRetry={() => void store.loadMetrikaGoals(configPath)}
          />
        ) : null}
        {goals.loading ? <Loading label={t("diagnostics.loading")} /> : null}

        {!goals.loading && goalsReport && !goalsReport.goals.length ? (
          <Notice variant="info">
            <strong>{t("diagnostics.metrika.noGoalsTitle")}</strong>
            <span>{t("diagnostics.metrika.noGoalsHint")}</span>
          </Notice>
        ) : null}

        {!goals.loading && goalsReport && goalsReport.goals.length ? (
          <>
            <div className="diagnostics-inline">
              {goalsReport.goals.map((id) => (
                <Badge key={id} tone="info">
                  {t("diagnostics.metrika.goalBadge", { id })}
                </Badge>
              ))}
            </div>
            {goalsReport.configured.length > goalsReport.goals.length ? (
              <p className="muted small">
                {t("diagnostics.metrika.goalsTruncated", {
                  queried: goalsReport.goals.length,
                  configured: goalsReport.configured.length,
                })}
              </p>
            ) : null}
            {goalsReport.rows.length ? (
              <Table caption={t("diagnostics.metrika.goalsTitle")}>
                <thead>
                  <tr>
                    <th scope="col">{t("diagnostics.metrika.columnBreakdown")}</th>
                    <th scope="col">{t("diagnostics.metrika.columnGoal")}</th>
                    <th scope="col">{t("diagnostics.metrika.columnReaches")}</th>
                    <th scope="col">{t("diagnostics.metrika.columnGoalVisits")}</th>
                    <th scope="col">{t("diagnostics.metrika.columnGoalUsers")}</th>
                    <th scope="col">{t("diagnostics.metrika.columnConversion")}</th>
                  </tr>
                </thead>
                <tbody>
                  {goalsReport.rows.flatMap((row, rowIndex) =>
                    row.goals.map((goal) => (
                      <tr key={`${row.label ?? rowIndex}-${goal.id}`}>
                        <td>{row.label ?? t("diagnostics.metrika.totalRow")}</td>
                        <td>
                          <code>{goal.id}</code>
                        </td>
                        <td>{formatNumber(goal.reaches, locale)}</td>
                        <td>{formatNumber(goal.visits, locale)}</td>
                        <td>{formatNumber(goal.users, locale)}</td>
                        <td>{formatPercent(goal.conversionRate, locale, 2)}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </Table>
            ) : (
              <EmptyState
                title={t("diagnostics.metrika.goalsEmptyTitle")}
                hint={t("diagnostics.metrika.goalsEmptyHint")}
              />
            )}
          </>
        ) : null}

        {!goals.loading && !goalsReport && !goals.error && !blocked ? (
          <p className="muted small">{t("diagnostics.metrika.goalsIdle")}</p>
        ) : null}
        {goalsReport ? (
          <MetaNotes meta={goalsReport.meta} showSampling />
        ) : null}
        <Warnings items={goals.warnings} />
      </Section>

      <Section
        id="diagnostics-metrika-devices"
        title={t("diagnostics.metrika.devicesTitle")}
        hint={t("diagnostics.metrika.devicesHint")}
        actions={loadButton(devices.loading, () => void store.loadMetrikaDevices(configPath))}
      >
        {devices.error ? (
          <ErrorNotice
            title={t("diagnostics.metrika.devicesError")}
            error={devices.error}
            onRetry={() => void store.loadMetrikaDevices(configPath)}
          />
        ) : null}
        {devices.loading ? (
          <Loading label={t("diagnostics.loading")} />
        ) : null}
        {!devices.loading && devicesReport && devicesReport.rows.length ? (
          <MetrikaTable
            caption={t("diagnostics.metrika.devicesTitle")}
            label={t("diagnostics.metrika.columnDevice")}
            rows={devicesReport.rows}
            locale={locale}
          />
        ) : null}
        {!devices.loading && devicesReport && !devicesReport.rows.length ? (
          <EmptyState
            title={t("diagnostics.metrika.devicesEmptyTitle")}
            hint={t("diagnostics.metrika.devicesEmptyHint")}
          />
        ) : null}
        {!devices.loading && !devicesReport && !devices.error && !blocked ? (
          <p className="muted small">{t("diagnostics.metrika.devicesIdle")}</p>
        ) : null}
        {devicesReport ? (
          <MetaNotes meta={devicesReport.meta} showSampling />
        ) : null}
        <Warnings items={devices.warnings} />
      </Section>

      <Section
        id="diagnostics-metrika-countries"
        title={t("diagnostics.metrika.countriesTitle")}
        hint={t("diagnostics.metrika.countriesHint")}
        actions={loadButton(countries.loading, () => void store.loadMetrikaCountries(configPath))}
      >
        {countries.error ? (
          <ErrorNotice
            title={t("diagnostics.metrika.countriesError")}
            error={countries.error}
            onRetry={() => void store.loadMetrikaCountries(configPath)}
          />
        ) : null}
        {countries.loading ? (
          <Loading label={t("diagnostics.loading")} />
        ) : null}
        {!countries.loading && countriesReport && countriesReport.rows.length ? (
          <MetrikaTable
            caption={t("diagnostics.metrika.countriesTitle")}
            label={t("diagnostics.metrika.columnCountry")}
            rows={countriesReport.rows}
            locale={locale}
          />
        ) : null}
        {!countries.loading &&
        countriesReport &&
        !countriesReport.rows.length ? (
          <EmptyState
            title={t("diagnostics.metrika.countriesEmptyTitle")}
            hint={t("diagnostics.metrika.countriesEmptyHint")}
          />
        ) : null}
        {!countries.loading &&
        !countriesReport &&
        !countries.error &&
        !blocked ? (
          <p className="muted small">
            {t("diagnostics.metrika.countriesIdle")}
          </p>
        ) : null}
        {countriesReport ? (
          <MetaNotes meta={countriesReport.meta} showSampling />
        ) : null}
        <Warnings items={countries.warnings} />
      </Section>

      <Section
        id="diagnostics-metrika-engagement"
        title={t("diagnostics.metrika.engagementTitle")}
        hint={t("diagnostics.metrika.engagementHint")}
        actions={loadButton(engagement.loading, () => void store.loadMetrikaEngagement(configPath))}
      >
        {engagement.error ? (
          <ErrorNotice
            title={t("diagnostics.metrika.engagementError")}
            error={engagement.error}
            onRetry={() => void store.loadMetrikaEngagement(configPath)}
          />
        ) : null}
        {engagement.loading ? (
          <Loading label={t("diagnostics.loading")} />
        ) : null}
        {!engagement.loading && engagementReport?.row ? (
          <div className="diagnostics-facts">
            <Fact
              label={t("diagnostics.metrika.columnVisits")}
              value={formatNumber(engagementReport.row.visits, locale)}
            />
            <Fact
              label={t("diagnostics.metrika.columnUsers")}
              value={formatNumber(engagementReport.row.users, locale)}
            />
            <Fact
              label={t("diagnostics.metrika.columnBounce")}
              value={formatPercent(engagementReport.row.bounceRate, locale, 1)}
            />
            <Fact
              label={t("diagnostics.metrika.columnDuration")}
              value={durationText(
                engagementReport.row.avgVisitDurationSeconds,
                locale,
              )}
            />
            <Fact
              label={t("diagnostics.metrika.columnDepth")}
              value={formatNumber(engagementReport.row.pageDepth, locale, 2)}
            />
            <Fact
              label={t("diagnostics.metrika.columnPageviews")}
              value={formatNumber(engagementReport.row.pageviews, locale)}
            />
          </div>
        ) : null}
        {!engagement.loading && engagementReport && !engagementReport.row ? (
          <EmptyState
            title={t("diagnostics.metrika.engagementEmptyTitle")}
            hint={t("diagnostics.metrika.engagementEmptyHint")}
          />
        ) : null}
        {!engagement.loading &&
        !engagementReport &&
        !engagement.error &&
        !blocked ? (
          <p className="muted small">
            {t("diagnostics.metrika.engagementIdle")}
          </p>
        ) : null}
        {engagementReport ? (
          <MetaNotes meta={engagementReport.meta} showSampling />
        ) : null}
        <Warnings items={engagement.warnings} />
      </Section>

      <Section
        id="diagnostics-metrika-bytime"
        title={t("diagnostics.metrika.bytimeTitle")}
        hint={t("diagnostics.metrika.bytimeHint")}
        actions={loadButton(bytime.loading, () => void store.loadMetrikaBytime(configPath))}
      >
        {bytime.error ? (
          <ErrorNotice
            title={t("diagnostics.metrika.bytimeError")}
            error={bytime.error}
            onRetry={() => void store.loadMetrikaBytime(configPath)}
          />
        ) : null}
        {bytime.loading ? <Loading label={t("diagnostics.loading")} /> : null}
        {!bytime.loading && bytimeReport && bytimeReport.rows.length ? (
          <Table caption={t("diagnostics.metrika.bytimeTitle")}>
            <thead>
              <tr>
                <th scope="col">{t("diagnostics.metrika.columnInterval")}</th>
                <th scope="col">{t("diagnostics.metrika.columnVisits")}</th>
                <th scope="col">{t("diagnostics.metrika.columnUsers")}</th>
              </tr>
            </thead>
            <tbody>
              {bytimeReport.rows.map((row, index) => (
                <tr key={`${row.date ?? "date"}-${index}`}>
                  <td>{row.date ?? t("common.notAvailable")}</td>
                  <td>{formatNumber(row.visits, locale)}</td>
                  <td>{formatNumber(row.users, locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}
        {!bytime.loading && bytimeReport && !bytimeReport.rows.length ? (
          <EmptyState
            title={t("diagnostics.metrika.bytimeEmptyTitle")}
            hint={t("diagnostics.metrika.bytimeEmptyHint")}
          />
        ) : null}
        {!bytime.loading && !bytimeReport && !bytime.error && !blocked ? (
          <p className="muted small">{t("diagnostics.metrika.bytimeIdle")}</p>
        ) : null}
        {bytimeReport ? (
          <MetaNotes meta={bytimeReport.meta} showSampling />
        ) : null}
        <Warnings items={bytime.warnings} />
      </Section>
    </>
  );
});
