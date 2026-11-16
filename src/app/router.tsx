import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ROUTES } from "@/app/routes";
import { useI18n } from "@/shared/i18n";
import { Loading } from "@/shared/ui/Loading";

const DashboardPage = lazy(() =>
  import("@/pages/dashboard/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  })),
);
const ReportsPage = lazy(() =>
  import("@/pages/reports/ReportsPage").then((module) => ({
    default: module.ReportsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("@/pages/settings/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);
const ConfigPage = lazy(() =>
  import("@/pages/config/ConfigPage").then((module) => ({
    default: module.ConfigPage,
  })),
);
const RecommendationsPage = lazy(() =>
  import("@/pages/recommendations/RecommendationsPage").then((module) => ({
    default: module.RecommendationsPage,
  })),
);
const CrawlPage = lazy(() =>
  import("@/pages/crawl/CrawlPage").then((module) => ({
    default: module.CrawlPage,
  })),
);
const LogsPage = lazy(() =>
  import("@/pages/logs/LogsPage").then((module) => ({
    default: module.LogsPage,
  })),
);
const TasksPage = lazy(() =>
  import("@/pages/tasks/TasksPage").then((module) => ({
    default: module.TasksPage,
  })),
);
const IntegrationsPage = lazy(() =>
  import("@/pages/integrations/IntegrationsPage").then((module) => ({
    default: module.IntegrationsPage,
  })),
);
const OnboardingPage = lazy(() =>
  import("@/pages/onboarding/OnboardingPage").then((module) => ({
    default: module.OnboardingPage,
  })),
);
const NotFoundPage = lazy(() =>
  import("@/pages/not-found/NotFoundPage").then((module) => ({
    default: module.NotFoundPage,
  })),
);

function RouteFallback() {
  const { t } = useI18n();
  return (
    <div className="page">
      <Loading label={t("common.loading")} />
    </div>
  );
}

/**
 * Stable URLs. Diagnostics live inside the configuration screen (doctor,
 * environment, validation), so `/diagnostics` is kept as a redirect for old
 * links instead of duplicating the same controls. Onboarding is reachable by
 * URL and from the dashboard empty state, but stays out of the primary nav.
 * Pages are code-split so the first window paints without loading every
 * settings form.
 */
export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path={ROUTES.dashboard} element={<DashboardPage />} />
        <Route path={ROUTES.reports} element={<ReportsPage />} />
        <Route path={ROUTES.settings} element={<SettingsPage />} />
        <Route path={ROUTES.config} element={<ConfigPage />} />
        <Route path={ROUTES.recommendations} element={<RecommendationsPage />} />
        <Route path={ROUTES.crawl} element={<CrawlPage />} />
        <Route path={ROUTES.logs} element={<LogsPage />} />
        <Route path={ROUTES.tasks} element={<TasksPage />} />
        <Route path={ROUTES.integrations} element={<IntegrationsPage />} />
        <Route path={ROUTES.onboarding} element={<OnboardingPage />} />
        <Route
          path={ROUTES.diagnostics}
          element={<Navigate to={ROUTES.config} replace />}
        />
        <Route
          path="/dashboard"
          element={<Navigate to={ROUTES.dashboard} replace />}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
