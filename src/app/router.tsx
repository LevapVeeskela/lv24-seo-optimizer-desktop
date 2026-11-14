import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
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
 * links instead of duplicating the same controls. Pages are code-split so the
 * first window paints without loading every settings form.
 */
export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/recommendations" element={<RecommendationsPage />} />
        <Route path="/diagnostics" element={<Navigate to="/config" replace />} />
        <Route path="/dashboard" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
