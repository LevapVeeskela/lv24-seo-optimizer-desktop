import { useI18n } from "@/shared/i18n";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Select } from "./Select";

export interface WindowPeriod {
  start: string;
  end: string;
}

/**
 * Date window and provider lag. Presentational: the entity store owns the
 * value and the per-workspace persistence, so the component stays usable in
 * tests and in any page.
 */
export function WindowPicker({
  days,
  lagDays,
  period,
  presets = [7, 28, 90],
  lagOptions = [2, 3],
  disabled = false,
  stale = false,
  onDaysChange,
  onLagChange,
  onReset,
}: {
  days: number;
  lagDays: number;
  period: WindowPeriod | null;
  presets?: readonly number[];
  lagOptions?: readonly number[];
  disabled?: boolean;
  stale?: boolean;
  onDaysChange: (days: number) => void;
  onLagChange: (lagDays: number) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="form-actions">
      <div
        className="segmented"
        role="group"
        aria-label={t("window.daysLabel")}
      >
        {presets.map((value) => (
          <button
            key={value}
            type="button"
            className={`segment${value === days ? " active" : ""}`}
            aria-pressed={value === days}
            disabled={disabled}
            onClick={() => onDaysChange(value)}
          >
            {t("window.days", { count: value })}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{t("window.lagLabel")}</span>
        <Select
          value={lagDays}
          disabled={disabled}
          aria-describedby="window-lag-hint"
          onChange={(event) => onLagChange(Number(event.target.value))}
        >
          {lagOptions.map((value) => (
            <option key={value} value={value}>
              {t("window.lagDays", { count: value })}
            </option>
          ))}
        </Select>
        <small id="window-lag-hint">{t("window.lagHint")}</small>
      </label>
      <span className="muted small">
        {t("window.activePeriod")}:{" "}
        <strong>
          {period
            ? t("window.periodValue", { start: period.start, end: period.end })
            : "—"}
        </strong>
      </span>
      <Button variant="ghost" onClick={onReset} disabled={disabled}>
        {t("window.reset")}
      </Button>
      {stale ? <Badge tone="warning">{t("window.stale")}</Badge> : null}
    </div>
  );
}
