import { useEffect } from "react";
import { windowStore, type WindowStore } from "./WindowStore";

/**
 * Bind the shared window store to the active workspace. The effect runs before
 * the caller's own effects, so a refresh started on mount already reads the
 * settings that belong to this workspace.
 */
export function useWindowSettings(configPath: string | null): WindowStore {
  useEffect(() => {
    windowStore.useWorkspace(configPath);
  }, [configPath]);
  return windowStore;
}
