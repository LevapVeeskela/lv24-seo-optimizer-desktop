import { invoke } from "@tauri-apps/api/core";
import { cliRun, type Envelope } from "@/shared/cli";

/**
 * `backup_create` allow-listed by the shell. `out` is the absolute directory
 * the user picked; the engine validates it and refuses a non-directory.
 */
export interface BackupCreateArgs {
  out: string;
  force: boolean;
}

export function runBackupCreate(
  args: BackupCreateArgs,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("backup_create", { args });
}

/**
 * `backup_restore` is two-phase. The plan phase sends neither `allowWrite` nor
 * `confirm`; the apply phase sends both, and the token must come from the plan
 * the user just reviewed. `configPath` is the active project config.
 */
export interface BackupRestoreArgs {
  file: string;
  configPath: string;
  allowWrite: boolean;
  confirm: string | null;
}

export function runBackupRestore(
  args: BackupRestoreArgs,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("backup_restore", {
    args: {
      file: args.file,
      allowWrite: args.allowWrite,
      ...(args.confirm ? { confirm: args.confirm } : {}),
    },
    configPath: args.configPath,
  });
}

/**
 * Native file picker owned by the shell. The shell approves the chosen `.zip`
 * for this session and returns its absolute path, or `null` on cancel.
 */
export async function pickBackupArchive(): Promise<string | null> {
  const selected = await invoke<string | null>("pick_backup_archive");
  return typeof selected === "string" && selected.trim() ? selected : null;
}
