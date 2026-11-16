import { useState } from "react";
import { observer } from "mobx-react-lite";
import { useNavigate } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import { ROUTES } from "@/app/routes";
import { initProject } from "@/entities/engine/api/onboarding";
import { pickConfig } from "@/entities/engine/api/shell";
import { siteLabel } from "@/entities/workspace";
import { OnboardingStore, OnboardingWizard } from "@/features/onboarding";
import { useConfirmWorkspaceChange } from "@/app/providers/DiscardGuard";
import { pickDirectory } from "@/shared/desktop/dialog";
import { useI18n } from "@/shared/i18n";
import { useFeedback } from "@/shared/ui/Feedback";

export const OnboardingPage = observer(function OnboardingPage() {
  const { t } = useI18n();
  const { engine, workspace } = useRootStore();
  const confirmWorkspaceChange = useConfirmWorkspaceChange();
  const navigate = useNavigate();
  const { notify } = useFeedback();
  const [store] = useState(
    () =>
      new OnboardingStore({
        pickDirectory,
        initProject,
        pickConfig,
        activate: (path) => workspace.activate(path),
        confirmWorkspaceChange,
      }),
  );

  const created = (configPath: string) => {
    const site = store.siteUrl.trim();
    workspace.remember({
      path: configPath,
      label: siteLabel(site) ?? undefined,
      site: site || undefined,
    });
    notify(t("onboarding.created"), "success");
    navigate(ROUTES.dashboard);
  };

  return (
    <OnboardingWizard
      store={store}
      offline={engine.offline}
      existingConfigPath={engine.status?.configPath ?? null}
      dashboardHref={ROUTES.dashboard}
      onCreated={created}
    />
  );
});
