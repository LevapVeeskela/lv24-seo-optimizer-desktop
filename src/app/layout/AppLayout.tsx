import { useEffect, useRef, type PropsWithChildren } from "react";
import { observer } from "mobx-react-lite";
import { Link, useLocation } from "react-router-dom";
import { AppHeader } from "@/app/layout/AppHeader";
import { AppNav } from "@/app/layout/AppNav";
import { BrandMark } from "@/app/layout/BrandMark";
import { activateSkipLink } from "@/app/layout/skipLink";
import { useDiscardGuard } from "@/app/providers/DiscardGuard";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useUnsavedDraftGuard } from "@/features/save-config";
import { useI18n } from "@/shared/i18n";
import { RunBanner } from "@/shared/run/ui/RunBanner";
import { useFeedback } from "@/shared/ui/Feedback";

export const AppLayout = observer(function AppLayout({
  children,
}: PropsWithChildren) {
  const { t } = useI18n();
  const { engine, config, runs } = useRootStore();
  const { confirmDiscard } = useDiscardGuard();
  const { notify } = useFeedback();
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

  // One close guard for the whole window: the shared ConfigStore draft can be
  // edited on Settings and still exist after navigating to another screen.
  useUnsavedDraftGuard({
    dirty: config.dirty,
    confirmDiscard: () => confirmDiscard("close"),
    discard: () => config.discard(),
    onError: () => notify(t("settings.unsaved.guardUnavailable"), "error"),
  });

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => activateSkipLink(event, mainRef.current)}
      >
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
        <RunBanner runs={runs} />
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
