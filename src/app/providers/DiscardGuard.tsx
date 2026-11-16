import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useRootStore } from "@/app/providers/StoreProvider";
import { confirmDiscardBeforeAction } from "@/features/save-config";
import { useI18n } from "@/shared/i18n";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";

/** Why the draft is about to be replaced; drives the dialog body. */
export type DiscardReason = "close" | "switch";

interface DiscardGuardValue {
  /** Resolves `true` only when the user agrees to discard the draft. */
  confirmDiscard: (reason: DiscardReason) => Promise<boolean>;
}

const DiscardGuardContext = createContext<DiscardGuardValue | null>(null);

/**
 * App-level discard confirmation. One dialog answers both the native close
 * guard and workspace switches, so a draft edited on Settings cannot be lost
 * by leaving the page or by picking another config.
 */
export function DiscardGuardProvider({ children }: PropsWithChildren) {
  const { t } = useI18n();
  const [reason, setReason] = useState<DiscardReason | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirmDiscard = useCallback(
    (next: DiscardReason) =>
      new Promise<boolean>((resolve) => {
        // A second request supersedes the first; never leave it pending.
        resolver.current?.(false);
        resolver.current = resolve;
        setReason(next);
      }),
    [],
  );

  const answer = useCallback((ok: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setReason(null);
    resolve?.(ok);
  }, []);

  const value = useMemo(() => ({ confirmDiscard }), [confirmDiscard]);

  return (
    <DiscardGuardContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={reason !== null}
        title={t("settings.unsaved.title")}
        confirmLabel={t("settings.unsaved.confirm")}
        cancelLabel={t("settings.unsaved.cancel")}
        danger
        onCancel={() => answer(false)}
        onConfirm={() => answer(true)}
      >
        <p>
          {t(
            reason === "close"
              ? "settings.unsaved.closeBody"
              : "settings.unsaved.switchBody",
          )}
        </p>
      </ConfirmDialog>
    </DiscardGuardContext.Provider>
  );
}

export function useDiscardGuard(): DiscardGuardValue {
  const value = useContext(DiscardGuardContext);
  if (!value) {
    throw new Error("DiscardGuardProvider is required");
  }
  return value;
}

/**
 * One call for every action that replaces the active workspace: confirms a
 * dirty draft, discards it only after approval, and returns `false` when the
 * user chooses to keep editing.
 */
export function useConfirmWorkspaceChange(): () => Promise<boolean> {
  const { config } = useRootStore();
  const { confirmDiscard } = useDiscardGuard();
  return useCallback(async () => {
    if (
      !(await confirmDiscardBeforeAction(config.dirty, () =>
        confirmDiscard("switch"),
      ))
    ) {
      return false;
    }
    if (config.dirty) {
      config.discard();
    }
    return true;
  }, [config, confirmDiscard]);
}
