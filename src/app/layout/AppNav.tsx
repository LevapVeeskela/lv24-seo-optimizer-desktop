import { NavLink } from "react-router-dom";
import { ROUTES } from "@/app/routes";
import { useI18n, type MessageKey } from "@/shared/i18n";

type IconName =
  | "dashboard"
  | "reports"
  | "settings"
  | "config"
  | "recommendations"
  | "crawl"
  | "logs"
  | "tasks"
  | "integrations"
  | "diagnostics";

export interface NavItem {
  to: string;
  key: MessageKey;
  icon: IconName;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: ROUTES.dashboard, key: "nav.dashboard", icon: "dashboard" },
  { to: ROUTES.reports, key: "nav.reports", icon: "reports" },
  { to: ROUTES.crawl, key: "nav.crawl", icon: "crawl" },
  { to: ROUTES.logs, key: "nav.logs", icon: "logs" },
  { to: ROUTES.tasks, key: "nav.tasks", icon: "tasks" },
  { to: ROUTES.integrations, key: "nav.integrations", icon: "integrations" },
  { to: ROUTES.settings, key: "nav.settings", icon: "settings" },
  { to: ROUTES.config, key: "nav.config", icon: "config" },
  { to: ROUTES.recommendations, key: "nav.recommendations", icon: "recommendations" },
];

function NavIcon({ name }: { name: IconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "dashboard":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3" y="3" width="7" height="7" rx="1.5" {...common} />
          <rect x="14" y="3" width="7" height="7" rx="1.5" {...common} />
          <rect x="3" y="14" width="7" height="7" rx="1.5" {...common} />
          <rect x="14" y="14" width="7" height="7" rx="1.5" {...common} />
        </svg>
      );
    case "reports":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M7 3h7l4 4v14H7z" {...common} />
          <path d="M14 3v5h5M10 13h5M10 17h5" {...common} />
        </svg>
      );
    case "crawl":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="10.5" cy="10.5" r="6.5" {...common} />
          <path d="m15.5 15.5 4.5 4.5M7 10.5h7M10.5 7v7" {...common} />
        </svg>
      );
    case "integrations":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0zM12 16v5" {...common} />
        </svg>
      );
    case "logs":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 4h14M5 9h14M5 14h9M5 19h6" {...common} />
        </svg>
      );
    case "tasks":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="4" y="4" width="16" height="16" rx="2.5" {...common} />
          <path d="m8.5 12 2.5 2.5 4.5-5" {...common} />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="3.2" {...common} />
          <path
            d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18"
            {...common}
          />
        </svg>
      );
    case "config":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" {...common} />
          <circle cx="16" cy="7" r="2.2" {...common} />
          <circle cx="10" cy="17" r="2.2" {...common} />
        </svg>
      );
    case "recommendations":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0c-.8.7-1.2 1.6-1.2 2.5H9.7c0-.9-.4-1.8-1.2-2.5Z"
            {...common}
          />
        </svg>
      );
    case "diagnostics":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 12h4l2-5 4 10 2-5h6" {...common} />
        </svg>
      );
  }
}

export function AppNav() {
  const { t } = useI18n();
  return (
    <nav className="sidebar-nav" aria-label={t("nav.primary")}>
      <p className="sidebar-nav-label">{t("nav.primary")}</p>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === ROUTES.dashboard}
          className={({ isActive }) =>
            `sidebar-link${isActive ? " active" : ""}`
          }
        >
          <NavIcon name={item.icon} />
          <span>{t(item.key)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
