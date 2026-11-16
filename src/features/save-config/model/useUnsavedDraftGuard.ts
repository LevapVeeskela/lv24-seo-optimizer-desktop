import { useEffect, useRef } from "react";
import {
  createTauriCloseGuardWindow,
  installCloseGuard,
  type CloseGuardWindow,
} from "./closeGuard";

export interface UnsavedDraftGuardOptions {
  /** Install the listener only while the draft differs from the saved file. */
  dirty: boolean;
  confirmDiscard: () => Promise<boolean>;
  discard: () => void;
  /** `null` disables the guard (tests, plain browser); omitted uses Tauri. */
  window?: CloseGuardWindow | null;
  onError?: (error: unknown) => void;
}

/**
 * Ask before the window close button discards an unsaved draft. The guard is
 * registered only while `dirty`; a clean window closes natively.
 */
export function useUnsavedDraftGuard({
  dirty,
  confirmDiscard,
  discard,
  window: adapter,
  onError,
}: UnsavedDraftGuardOptions): void {
  const options = useRef({ dirty, confirmDiscard, discard, onError });

  useEffect(() => {
    options.current = { dirty, confirmDiscard, discard, onError };
  }, [dirty, confirmDiscard, discard, onError]);

  useEffect(() => {
    if (!dirty || adapter === null) {
      return;
    }
    let cancelled = false;
    let release: (() => void) | null = null;

    const start = async () => {
      try {
        const target = adapter ?? (await createTauriCloseGuardWindow());
        if (!target || cancelled) {
          return;
        }
        const unlisten = await installCloseGuard(target, {
          isDirty: () => options.current.dirty,
          confirmDiscard: () => options.current.confirmDiscard(),
          discard: () => options.current.discard(),
          onError: (error) => options.current.onError?.(error),
        });
        if (cancelled) {
          unlisten();
          return;
        }
        release = unlisten;
      } catch (error) {
        // A shell without the event permission must not break settings; the
        // draft is still protected by the workspace-switch and reload guards.
        options.current.onError?.(error);
      }
    };

    void start();
    return () => {
      cancelled = true;
      const unlisten = release;
      release = null;
      unlisten?.();
    };
  }, [dirty, adapter]);
}
