/**
 * Command-save predicate shared by the settings shortcut and its tests.
 * Ctrl+S on Windows/Linux and Cmd+S on macOS save the draft; Alt/Shift
 * combinations stay with the platform so browser and OS shortcuts keep
 * working.
 */
export interface SaveShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}

export function isSaveShortcut(event: SaveShortcutEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) {
    return false;
  }
  if (event.altKey || event.shiftKey) {
    return false;
  }
  if (!event.ctrlKey && !event.metaKey) {
    return false;
  }
  return event.key.toLowerCase() === "s";
}

/** Minimal document surface so the guard can be tested without jsdom. */
export interface QueryableDocument {
  querySelector(selectors: string): unknown;
}

/**
 * A native `<dialog>` opened with `showModal()` owns the keyboard. Saving the
 * form behind it would be surprising, so the shortcut stands down.
 */
export function hasOpenModal(
  doc: QueryableDocument | null = typeof document === "undefined"
    ? null
    : document,
): boolean {
  return Boolean(doc?.querySelector("dialog[open]"));
}

export interface KeyTarget {
  addEventListener(
    type: "keydown",
    listener: (event: KeyboardEvent) => void,
  ): void;
  removeEventListener(
    type: "keydown",
    listener: (event: KeyboardEvent) => void,
  ): void;
}

/**
 * Wire the command-save listener. Returns the unbind function; the hook and
 * the tests share this path so the keyboard contract is tested directly.
 */
export function bindSaveShortcut(
  target: KeyTarget,
  onSave: () => void,
  isModalOpen: () => boolean = () => hasOpenModal(),
): () => void {
  const listener = (event: KeyboardEvent) => {
    if (!isSaveShortcut(event) || isModalOpen()) {
      return;
    }
    event.preventDefault();
    onSave();
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}
