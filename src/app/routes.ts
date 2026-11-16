/**
 * Stable route paths. Kept free of page imports so tests and navigation can
 * use them without pulling every screen into the first chunk.
 */
export const ROUTES = {
  dashboard: "/",
  reports: "/reports",
  settings: "/settings",
  config: "/config",
  recommendations: "/recommendations",
  crawl: "/crawl",
  logs: "/logs",
  tasks: "/tasks",
  integrations: "/integrations",
  onboarding: "/onboarding",
  diagnostics: "/diagnostics",
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];
