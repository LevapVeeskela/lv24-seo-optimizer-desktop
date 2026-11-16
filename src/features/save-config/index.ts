export { SaveConfigBar } from "./ui/SaveConfigBar";
export { isSaveShortcut, hasOpenModal, bindSaveShortcut } from "./model/shortcut";
export type { SaveShortcutEvent, KeyTarget } from "./model/shortcut";
export {
  installCloseGuard,
  createTauriCloseGuardWindow,
} from "./model/closeGuard";
export type {
  CloseGuardEvent,
  CloseGuardOptions,
  CloseGuardWindow,
} from "./model/closeGuard";
export { confirmDiscardBeforeAction } from "./model/discardGate";
export { useSaveShortcut } from "./model/useSaveShortcut";
export { useUnsavedDraftGuard } from "./model/useUnsavedDraftGuard";
export type { UnsavedDraftGuardOptions } from "./model/useUnsavedDraftGuard";
