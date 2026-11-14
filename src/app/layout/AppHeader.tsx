import { observer } from "mobx-react-lite";
import { useLocation } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import { UpdateBadge } from "@/features/update";
import {
  LOCALES,
  useI18n,
  type Locale,
  type MessageKey,
} from "@/shared/i18n";

const SECTION_KEYS: Record<string, MessageKey> = {
  "/": "nav.dashboard",
  "/reports": "nav.reports",
  "/settings": "nav.settings",
  "/config": "nav.config",
  "/recommendations": "nav.recommendations",
  "/diagnostics": "nav.diagnostics",
};

const LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  ru: "RU",
  zh: "中文",
};

export const AppHeader = observer(function AppHeader() {
  const { t, locale, setLocale } = useI18n();
  const { engine } = useRootStore();
  const location = useLocation();
  const section = SECTION_KEYS[location.pathname] ?? "app.title";
  const online = engine.state === "ready";

  return (
    <header className="app-header">
      <div className="app-header-title">
        <strong>{t(section)}</strong>
        <span>{t("app.subtitle")}</span>
      </div>
      <div className="app-header-actions">
        <span
          className={`status-pill ${online ? "status-running" : "status-stopped"}`}
        >
          <span className="status-dot" aria-hidden="true" />
          {engine.loading
            ? t("common.loading")
            : online
              ? t("engine.online")
              : t("engine.offline")}
        </span>
        <UpdateBadge />
        <div className="locale-switch" role="group" aria-label={t("locale.label")}>
          {LOCALES.map((item) => (
            <button
              key={item}
              type="button"
              className={`locale-option${locale === item ? " active" : ""}`}
              aria-pressed={locale === item}
              lang={item}
              onClick={() => setLocale(item)}
            >
              {LOCALE_LABELS[item]}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
});
