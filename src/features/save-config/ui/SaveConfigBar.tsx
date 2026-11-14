import { useI18n } from "@/shared/i18n";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";

export function SaveConfigBar({
  dirty,
  saving,
  validating,
  canSave,
  errorCount,
  warningCount,
  lastBackup,
  onSave,
  onDiscard,
  onValidate,
}: {
  dirty: boolean;
  saving: boolean;
  validating: boolean;
  canSave: boolean;
  errorCount: number;
  warningCount: number;
  lastBackup: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onValidate: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="form-actions" role="group" aria-label={t("settings.bar.label")}>
      <div className="badge-row" aria-live="polite">
        <Badge tone={dirty ? "warning" : "success"}>
          {dirty ? t("settings.bar.dirty") : t("settings.bar.clean")}
        </Badge>
        {errorCount > 0 ? (
          <Badge tone="danger">
            {t("settings.bar.errors", { count: errorCount })}
          </Badge>
        ) : null}
        {warningCount > 0 ? (
          <Badge tone="warning">
            {t("settings.bar.warnings", { count: warningCount })}
          </Badge>
        ) : null}
      </div>
      <Button
        variant="primary"
        loading={saving}
        disabled={!canSave}
        onClick={onSave}
      >
        {saving ? t("settings.bar.saving") : t("settings.bar.save")}
      </Button>
      <Button
        variant="secondary"
        disabled={!dirty || saving}
        onClick={onDiscard}
      >
        {t("settings.bar.discard")}
      </Button>
      <Button
        variant="secondary"
        loading={validating}
        disabled={saving}
        onClick={onValidate}
      >
        {validating ? t("settings.bar.validating") : t("settings.bar.validate")}
      </Button>
      {lastBackup ? (
        <span className="muted small">
          {t("settings.bar.lastBackup", { path: lastBackup })}
        </span>
      ) : null}
      <span className="muted small">{t("settings.bar.hint")}</span>
    </div>
  );
}
