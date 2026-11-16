/**
 * Unsaved-draft guard for the native window close button.
 *
 * Tauri's `onCloseRequested` only reaches the webview while a JS listener is
 * registered, and registering one makes the core prevent the native close.
 * The guard therefore lives behind this small adapter: tests use a fake
 * window, the app uses Tauri, and a plain browser (where Tauri is absent)
 * simply gets no guard instead of a trapped window.
 */

export interface CloseGuardEvent {
  /** Keep the window open while the user decides. */
  preventDefault(): void;
}

export interface CloseGuardWindow {
  /** Resolves to an unlisten function. */
  onCloseRequested(
    handler: (event: CloseGuardEvent) => void | Promise<void>,
  ): Promise<() => void>;
  /** Close after the user confirmed discarding the draft. */
  close(): Promise<void>;
}

export interface CloseGuardOptions {
  isDirty(): boolean;
  /** Resolves `true` when the draft may be discarded. */
  confirmDiscard(): Promise<boolean>;
  discard(): void;
  onError?(error: unknown): void;
}

/**
 * Install the close guard. The caller is responsible for calling the returned
 * function when the draft becomes clean: while the listener exists Tauri keeps
 * the window open on close, so a stale listener would trap the user.
 */
export async function installCloseGuard(
  window: CloseGuardWindow,
  options: CloseGuardOptions,
): Promise<() => void> {
  let release: (() => void) | null = null;
  let deciding = false;

  const handler = async (event: CloseGuardEvent): Promise<void> => {
    if (!options.isDirty()) {
      // A listener that outlived the dirty draft must not block a clean close.
      return;
    }
    event.preventDefault();
    if (deciding) {
      return;
    }
    deciding = true;
    try {
      if (!(await options.confirmDiscard())) {
        return;
      }
      options.discard();
      // `close()` emits `close-requested` again; drop the listener first so the
      // guard cannot re-enter and ask twice.
      const unlisten = release;
      release = null;
      unlisten?.();
      await window.close();
    } catch (error) {
      options.onError?.(error);
    } finally {
      deciding = false;
    }
  };

  release = await window.onCloseRequested(handler);
  return () => {
    const unlisten = release;
    release = null;
    unlisten?.();
  };
}

/**
 * Tauri-backed window. `getCurrentWindow().destroy()` needs
 * `core:window:allow-destroy`; the shell's `core:default` does not grant it, so
 * the single-window app falls back to exiting, which is the same user-visible
 * result. Both calls are no-ops outside a Tauri webview.
 */
export async function createTauriCloseGuardWindow(): Promise<CloseGuardWindow | null> {
  try {
    const [{ getCurrentWindow }, processPlugin] = await Promise.all([
      import("@tauri-apps/api/window"),
      import("@tauri-apps/plugin-process"),
    ]);
    const window = getCurrentWindow();
    return {
      onCloseRequested: (handler) => window.onCloseRequested(handler),
      close: async () => {
        try {
          await window.destroy();
        } catch {
          await processPlugin.exit(0);
        }
      },
    };
  } catch {
    return null;
  }
}
