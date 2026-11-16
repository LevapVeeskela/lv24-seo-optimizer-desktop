import { cliRun, type CliRunOptions, type Envelope } from "@/shared/cli";

/**
 * `backup_create` allow-listed by the shell. `out` is the absolute directory
 * the user picked; the engine validates it and refuses a non-directory.
 *
 * `CliArgs` does not declare `out` yet (package A owns that file), so the cast
 * is limited to this one bridge and is removed when the field lands.
 */
export interface BackupCreateArgs {
  out: string;
  force: boolean;
}

export function runBackupCreate(
  args: BackupCreateArgs,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("backup_create", {
    args: args as unknown as CliRunOptions["args"],
  });
}
