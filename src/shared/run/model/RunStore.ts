import type { CliCommandId, Envelope } from "@/shared/cli";
import { makeAutoObservable } from "mobx";
import { cancelRun } from "../lib/ipc";
import { RUN_KIND_COMMANDS, type RunKind, type RunRecord, type RunStatus } from "./types";

export interface RunStoreDeps {
  /** Overridable for tests; defaults to the `run_cancel` IPC command. */
  cancel?: (runId: string) => Promise<boolean>;
  newId?: () => string;
  now?: () => number;
  /** Bounded history; active runs are never trimmed. */
  limit?: number;
}

function defaultRunId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** One tracked run. Fields mutate in place so the banner and pages share it. */
export class RunEntry implements RunRecord {
  status: RunStatus = "running";
  finishedAt: number | null = null;
  durationMs: number | null = null;
  errorCode: string | null = null;
  cancelRequested = false;
  dismissed = false;

  constructor(
    readonly id: string,
    readonly kind: RunKind,
    readonly command: CliCommandId,
    readonly startedAt: number,
  ) {
    makeAutoObservable<RunEntry, "id" | "kind" | "command" | "startedAt">(
      this,
      { id: false, kind: false, command: false, startedAt: false },
      { autoBind: true },
    );
  }
}

function isActive(entry: RunEntry): boolean {
  return entry.status === "running" || entry.status === "cancelling";
}

/**
 * Window-wide registry of long engine calls.
 *
 * It lives in the root store, not on a page: leaving the screen does not clear
 * the active run, the banner keeps showing it, and a later visit reads the same
 * entry. The actual child process is owned by Rust; this store is the UI's
 * truthful view of the run id and its result.
 */
export class RunStore {
  /** Newest first; bounded by `limit` except for active runs. */
  entries: RunEntry[] = [];

  private readonly cancelRunFn: (runId: string) => Promise<boolean>;
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly limit: number;

  constructor(deps: RunStoreDeps = {}) {
    this.cancelRunFn = deps.cancel ?? cancelRun;
    this.newId = deps.newId ?? defaultRunId;
    this.now = deps.now ?? Date.now;
    this.limit = deps.limit ?? 20;
    makeAutoObservable<
      RunStore,
      "cancelRunFn" | "newId" | "now" | "limit"
    >(
      this,
      { cancelRunFn: false, newId: false, now: false, limit: false },
      { autoBind: true },
    );
  }

  get active(): RunEntry[] {
    return this.entries.filter(isActive);
  }

  get activeCount(): number {
    return this.active.length;
  }

  /**
   * What the global banner shows: every active run, or the newest cancelled
   * run until it is dismissed. Succeeded and failed runs stay on the page that
   * started them, where their result and error are explained.
   */
  get bannerEntries(): RunEntry[] {
    const active = this.active;
    if (active.length > 0) {
      return active;
    }
    const cancelled = this.entries.find(
      (entry) => entry.status === "cancelled" && !entry.dismissed,
    );
    return cancelled ? [cancelled] : [];
  }

  start(kind: RunKind): RunEntry {
    const entry = new RunEntry(
      this.newId(),
      kind,
      RUN_KIND_COMMANDS[kind],
      this.now(),
    );
    this.entries.unshift(entry);
    this.trim();
    return entry;
  }

  activeFor(kind: RunKind): RunEntry | null {
    return this.entries.find((entry) => entry.kind === kind && isActive(entry)) ?? null;
  }

  find(runId: string): RunEntry | null {
    return this.entries.find((entry) => entry.id === runId) ?? null;
  }

  /**
   * Record the run's terminal status. The envelope is authoritative: `ok`
   * means the engine produced a result, and only `RUN_CANCELLED` (or a cancel
   * the shell accepted) produces the distinct cancelled state.
   */
  settle(entry: RunEntry, envelope: Envelope<unknown>): RunStatus {
    const finishedAt = this.now();
    entry.finishedAt = finishedAt;
    entry.durationMs = Math.max(0, finishedAt - entry.startedAt);
    if (envelope.ok) {
      entry.status = "succeeded";
      entry.errorCode = null;
    } else if (entry.cancelRequested || envelope.error.code === "RUN_CANCELLED") {
      entry.status = "cancelled";
      entry.errorCode = "RUN_CANCELLED";
    } else {
      entry.status = "failed";
      entry.errorCode = envelope.error.code;
    }
    this.trim();
    return entry.status;
  }

  /**
   * Ask the shell to cancel one run. Returns `true` only when the shell
   * confirmed that the run was active. A refused request puts the entry back to
   * `running`; the pending envelope decides whether it succeeded or failed.
   */
  async cancel(runId: string): Promise<boolean> {
    const entry = this.find(runId);
    if (!entry || entry.status !== "running") {
      return false;
    }
    entry.status = "cancelling";
    entry.cancelRequested = true;
    let accepted = false;
    try {
      accepted = await this.cancelRunFn(runId);
    } catch {
      accepted = false;
    }
    if (!accepted && entry.status === "cancelling") {
      entry.cancelRequested = false;
      entry.status = "running";
    }
    return accepted;
  }

  dismiss(runId: string): void {
    const entry = this.find(runId);
    if (entry && !isActive(entry)) {
      entry.dismissed = true;
    }
  }

  private trim(): void {
    for (
      let index = this.entries.length - 1;
      index >= 0 && this.entries.length > this.limit;
      index -= 1
    ) {
      if (!isActive(this.entries[index])) {
        this.entries.splice(index, 1);
      }
    }
  }
}
