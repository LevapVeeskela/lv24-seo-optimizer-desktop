import {
  type LogFacets,
  type LogFilters,
} from "@/entities/logs";
import { useI18n } from "@/shared/i18n";
import { Button } from "@/shared/ui/Button";
import { Field } from "@/shared/ui/Field";
import { Select } from "@/shared/ui/Select";
import { BOT_KEYS, STATUS_KEYS } from "../model/labels";

/**
 * Table filters apply to the rows already returned by the engine; they never
 * trigger another run and never hide the engine's own bot filter.
 */
export function LogsFilterBar({
  facets,
  filters,
  onChange,
  onReset,
}: {
  facets: LogFacets;
  filters: LogFilters;
  onChange: (filters: LogFilters) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="form-grid logs-filters">
      <Field id="logs-filter-bot" label={t("logs.filterBot")}>
        <Select
          id="logs-filter-bot"
          value={filters.bot}
          onChange={(event) =>
            onChange({ ...filters, bot: event.target.value as LogFilters["bot"] })
          }
        >
          <option value="all">{t("logs.filterAll")}</option>
          {facets.bots.map((facet) => (
            <option key={facet.value} value={facet.value}>
              {t(BOT_KEYS[facet.value])} ({facet.count})
            </option>
          ))}
        </Select>
      </Field>

      <Field id="logs-filter-status" label={t("logs.filterStatus")}>
        <Select
          id="logs-filter-status"
          value={filters.status}
          onChange={(event) =>
            onChange({
              ...filters,
              status: event.target.value as LogFilters["status"],
            })
          }
        >
          <option value="all">{t("logs.filterAll")}</option>
          {facets.statuses.map((facet) => (
            <option key={facet.value} value={facet.value}>
              {t(STATUS_KEYS[facet.value])} ({facet.count})
            </option>
          ))}
        </Select>
      </Field>

      <div className="form-actions">
        <Button variant="ghost" onClick={onReset}>
          {t("logs.filterReset")}
        </Button>
      </div>
    </div>
  );
}
