import { useEffect, useRef } from "react";
import { bindSaveShortcut } from "./shortcut";

/**
 * Ctrl/Cmd+S saves the current draft while the settings form is open. The
 * listener is scoped to the mounted page, so other screens keep the platform
 * default.
 */
export function useSaveShortcut(enabled: boolean, onSave: () => void): void {
  const saveRef = useRef(onSave);

  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return bindSaveShortcut(document, () => saveRef.current());
  }, [enabled]);
}
