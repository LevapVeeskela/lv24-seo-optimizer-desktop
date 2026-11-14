import { useEffect, useRef, type PropsWithChildren } from "react";
import { observer } from "mobx-react-lite";
import { Link, useLocation } from "react-router-dom";
import { AppHeader } from "@/app/layout/AppHeader";
import { AppNav } from "@/app/layout/AppNav";
import { BrandMark } from "@/app/layout/BrandMark";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n } from "@/shared/i18n";

export const AppLayout = observer(function AppLayout({
  children,
}: PropsWithChildren) {
  const { t } = useI18n();
  const { engine } = useRootStore();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t("app.skipToContent")}
      </a>
      <aside className="app-sidebar">
        <Link to="/" className="sidebar-brand" aria-label={t("app.title")}>
          <BrandMark />
          <span className="sidebar-brand-copy">
            <strong>
              LV24 <span className="brand-accent">SEO</span>
            </strong>
            <span>{t("app.subtitle")}</span>
          </span>
        </Link>
        <AppNav />
        <div className="sidebar-footer">
          <span>
            {t("footer.desktop", {
              version: engine.desktop ?? t("common.notAvailable"),
            })}
          </span>
          <span>
            {engine.version
              ? t("footer.engine", { version: engine.version })
              : engine.offline
                ? t("footer.engineOffline")
                : t("engine.unknownVersion")}
          </span>
        </div>
      </aside>
      <div className="app-main">
        <AppHeader />
        <main
          id="main-content"
          className="app-content"
          tabIndex={-1}
          ref={mainRef}
        >
          {children}
        </main>
        <footer className="app-footer">
          <span>{t("app.title")}</span>
          <span>
            {engine.version
              ? t("footer.engine", { version: engine.version })
              : t("footer.engineOffline")}
          </span>
        </footer>
      </div>
    </div>
  );
});
