import { useEffect, useState } from "react";
import { HashRouter } from "react-router-dom";
import { AppLayout } from "@/app/layout/AppLayout";
import { RootStore } from "@/app/model/RootStore";
import { DiscardGuardProvider } from "@/app/providers/DiscardGuard";
import { I18nHost } from "@/app/providers/I18nHost";
import { StoreProvider } from "@/app/providers/StoreProvider";
import { AppRoutes } from "@/app/router";
import { RouteErrorBoundary } from "@/app/ui/ErrorBoundary";
import { FeedbackProvider } from "@/shared/ui/Feedback";

export function App() {
  const [store] = useState(() => new RootStore());

  useEffect(() => {
    void store.bootstrap();
  }, [store]);

  return (
    <StoreProvider store={store}>
      <I18nHost>
        <FeedbackProvider>
          <DiscardGuardProvider>
            <HashRouter>
              <AppLayout>
                <RouteErrorBoundary>
                  <AppRoutes />
                </RouteErrorBoundary>
              </AppLayout>
            </HashRouter>
          </DiscardGuardProvider>
        </FeedbackProvider>
      </I18nHost>
    </StoreProvider>
  );
}
