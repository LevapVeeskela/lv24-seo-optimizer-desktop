import type { CSSProperties } from "react";
import { useI18n } from "@/shared/i18n";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";

/**
 * The bar docks to the bottom of the scrolling settings page so save/discard
 * stay reachable in a ~900-line form. Inline styles keep the change inside the
 * feature: `app/styles/global.css` belongs to the shell package.
 */
const stickyStyle: CSSProperties = {
  position: "sticky",
  bottom: 0,
  zIndex: 5,
  background: "var(--canvas)",
  borderTop: "1px solid var(--border)",
  paddingBlock: "var(--space-3)",
};

export function SaveConfigBar({
  dirty,
  saving,
  validating,
  canSave,
  changedCount,
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
  /** Field-level diff size; shown so "unsaved" has a number next to it. */
  changedCount?: number;
  errorCount: number;
  warningCount: number;
  lastBackup: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onValidate: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="form-actions"
      role="group"
      aria-label={t("settings.bar.label")}
      data-sticky="true"
      style={stickyStyle}
    >
      <div className="badge-row" aria-live="polite">
        <Badge tone={dirty ? "warning" : "success"}>
          {dirty ? t("settings.bar.dirty") : t("settings.bar.clean")}
        </Badge>
        {dirty && changedCount ? (
          <Badge tone="neutral">
            {t("settings.bar.changed", { count: changedCount })}
          </Badge>
        ) : null}
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
        aria-keyshortcuts="Control+S Meta+S"
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
      <span className="muted small">{t("settings.bar.shortcut")}</span>
    </div>
  );
}
