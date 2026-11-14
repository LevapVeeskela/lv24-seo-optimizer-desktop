import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n } from "@/shared/i18n";

/** Compact header hint that opens the update panel on the Settings page. */
export const UpdateBadge = observer(function UpdateBadge() {
  const { t } = useI18n();
  const { update } = useRootStore();
  const available = update.available;
  if (!available) {
    return null;
  }
  return (
    <Link
      to="/settings"
      className="badge badge-info"
      aria-label={t("update.badgeLabel", { version: available.version })}
    >
      {t("update.badge", { version: available.version })}
    </Link>
  );
});
