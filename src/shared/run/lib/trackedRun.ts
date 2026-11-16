import {
  cliRun,
  type CliArgs,
  type Envelope,
} from "@/shared/cli";
import { toAppError } from "@/shared/lib/errors";
import type { RunStore } from "../model/RunStore";
import { RUN_KIND_COMMANDS, type RunKind } from "../model/types";

export interface TrackRunRequest<T> {
  kind: RunKind;
  /** The actual call; receives the run id the shell must be given. */
  run: (runId: string) => Promise<Envelope<T>>;
}

/**
 * Run one engine call under a tracked run id.
 *
 * The run is registered before the call, so the banner and Cancel button are
 * available immediately, and settled in every path, so a thrown IPC error
 * cannot leave a banner stuck on "running". The returned envelope is unchanged;
 * callers branch on `RUN_CANCELLED` for the distinct cancelled state.
 */
export async function trackRun<T>(
  runs: RunStore,
  request: TrackRunRequest<T>,
): Promise<Envelope<T>> {
  const entry = runs.start(request.kind);
  let envelope: Envelope<T>;
  try {
    envelope = await request.run(entry.id);
  } catch (error) {
    const app = toAppError(error, "RUN_FAILED");
    envelope = {
      ok: false,
      error: {
        code: app.code,
        message: app.message,
        ...(app.nextAction ? { next_action: app.nextAction } : {}),
        retryable: false,
      },
      meta: {},
      warnings: [],
    };
  }
  runs.settle(entry, envelope);
  return envelope;
}

export interface TrackedCliRequest {
  kind: RunKind;
  args?: CliArgs;
  configPath?: string;
}

/** Convenience wrapper for stores that call the shared `cli_run` transport. */
export function trackedCliRun<T>(
  runs: RunStore,
  request: TrackedCliRequest,
): Promise<Envelope<T>> {
  const command = RUN_KIND_COMMANDS[request.kind];
  return trackRun(runs, {
    kind: request.kind,
    run: (runId) =>
      cliRun<T>(command, {
        ...(request.args ? { args: request.args } : {}),
        ...(request.configPath ? { configPath: request.configPath } : {}),
        runId,
      }),
  });
}
