import { invoke } from "@tauri-apps/api/core";

/**
 * Ask the shell to cancel one active run by its stable id.
 *
 * `false` means the run already finished (or the id is unknown). The caller
 * must not show a cancelled state in that case: the run's own envelope is the
 * source of truth for its result.
 */
export async function cancelRun(runId: string): Promise<boolean> {
  return invoke<boolean>("run_cancel", { runId });
}
