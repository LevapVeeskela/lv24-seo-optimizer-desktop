import { useEffect, useRef, useState, type Ref } from "react";
import { observer } from "mobx-react-lite";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/app/routes";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useConfirmWorkspaceChange } from "@/app/providers/DiscardGuard";
import { pickConfig } from "@/entities/engine/api/shell";
import {
  samePath,
  siteLabel,
  type RecentWorkspace,
} from "@/entities/workspace";
import { useI18n } from "@/shared/i18n";
import { appErrorText, toAppError, type AppError } from "@/shared/lib/errors";
import { Button } from "@/shared/ui/Button";
import { useFeedback } from "@/shared/ui/Feedback";

export interface WorkspaceChipViewProps {
  site: string | null;
  label: string;
  configPath: string | null;
  recents: readonly RecentWorkspace[];
  activePath: string | null;
  busyPath: string | null;
  open: boolean;
  containerRef?: Ref<HTMLDivElement>;
  onToggle: () => void;
  onActivate: (path: string) => void;
  onClear: () => void;
  onChoose: () => void;
  onCreate: () => void;
}

export function WorkspaceChipView({
  site,
  label,
  configPath,
  recents,
  activePath,
  busyPath,
  open,
  containerRef,
  onToggle,
  onActivate,
  onClear,
  onChoose,
  onCreate,
}: WorkspaceChipViewProps) {
  const { t } = useI18n();
  const title = site || label || t("workspace.none");
  return (
    <div className="workspace-chip" ref={containerRef}>
      <button
        type="button"
        className="workspace-chip-button"
        aria-expanded={open}
        aria-controls="workspace-chip-menu"
        title={configPath ?? undefined}
        onClick={onToggle}
      >
        <span className="workspace-chip-copy">
          <span className="workspace-chip-site">{title}</span>
          {configPath ? (
            <span className="workspace-chip-path">{configPath}</span>
          ) : null}
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          className="workspace-chip-chevron"
        >
          <path
            d="m7 10 5 5 5-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div
          id="workspace-chip-menu"
          className="workspace-chip-menu"
          role="group"
          aria-label={t("workspace.recent")}
        >
          <p className="workspace-chip-label">{t("workspace.recent")}</p>
          {recents.length ? (
            <ul className="workspace-chip-list">
              {recents.map((entry) => {
                const active = samePath(entry.path, activePath);
                const busy = samePath(entry.path, busyPath);
                return (
                  <li key={entry.path}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      className="workspace-chip-item"
                      disabled={busyPath !== null}
                      title={entry.path}
                      onClick={() => onActivate(entry.path)}
                    >
                      <span>
                        {entry.label}
                        {active ? ` · ${t("workspace.active")}` : ""}
                        {busy ? ` · ${t("workspace.activating")}` : ""}
                      </span>
                      <small>{entry.site ?? entry.path}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="workspace-chip-empty">{t("workspace.recentEmpty")}</p>
          )}
          <div className="workspace-chip-actions">
            <Button variant="secondary" onClick={onChoose}>
              {t("workspace.choose")}
            </Button>
            <Button variant="secondary" onClick={onCreate}>
              {t("workspace.openOnboarding")}
            </Button>
            {recents.length ? (
              <Button variant="link" onClick={onClear}>
                {t("workspace.clear")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function activationMessage(error: AppError, t: (key: "errors.pathNotApproved" | "workspace.activateFailed") => string): string {
  if (error.code === "PATH_NOT_APPROVED") {
    return t("errors.pathNotApproved");
  }
  if (error.code === "WORKSPACE_NOT_ACTIVATED") {
    return t("workspace.activateFailed");
  }
  return appErrorText(error);
}

export const WorkspaceChip = observer(function WorkspaceChip() {
  const { t } = useI18n();
  const { engine, workspace, properties } = useRootStore();
  const confirmWorkspaceChange = useConfirmWorkspaceChange();
  const { notify } = useFeedback();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const configPath = engine.status?.configPath ?? null;
  const projectSite =
    properties.path && samePath(properties.path, configPath)
      ? properties.project?.baseUrl ?? null
      : null;
  const site = siteLabel(projectSite ?? workspace.site);
  const label =
    workspace.label ||
    (properties.path && samePath(properties.path, configPath)
      ? properties.project?.name ?? ""
      : "");

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const runActivation = async (path: string) => {
    const result = await workspace.activate(path);
    if (result.ok) {
      notify(t("workspace.activated", { label: workspace.label }), "success");
      navigate(ROUTES.dashboard);
      return;
    }
    if (result.error) {
      notify(activationMessage(result.error, t), "error");
    }
  };

  const activate = async (path: string) => {
    setOpen(false);
    if (!(await confirmWorkspaceChange())) {
      return;
    }
    await runActivation(path);
  };

  const choose = async () => {
    setOpen(false);
    // The picker persists the new path immediately, so confirm before it opens.
    if (!(await confirmWorkspaceChange())) {
      return;
    }
    try {
      const selected = await pickConfig();
      if (!selected) {
        return;
      }
      await runActivation(selected);
    } catch (error) {
      notify(toAppError(error, "PICK_CONFIG").message, "error");
    }
  };

  const clear = () => {
    workspace.clear();
    setOpen(false);
    notify(t("workspace.cleared"), "success");
  };

  return (
    <WorkspaceChipView
      site={site}
      label={label}
      configPath={configPath}
      recents={workspace.recents}
      activePath={configPath}
      busyPath={workspace.activatingPath}
      open={open}
      containerRef={containerRef}
      onToggle={() => setOpen((current) => !current)}
      onActivate={(path) => void activate(path)}
      onClear={clear}
      onChoose={() => void choose()}
      onCreate={() => {
        setOpen(false);
        navigate(ROUTES.onboarding);
      }}
    />
  );
});
