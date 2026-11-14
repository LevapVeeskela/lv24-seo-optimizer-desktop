import { shellStatus } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";
import { makeAutoObservable } from "mobx";
import {
  desktopVersion,
  engineReady,
  engineVersion,
  type EngineState,
  type ShellStatus,
} from "./types";

export class EngineStore {
  status: ShellStatus | null = null;
  state: EngineState = "idle";
  error: AppError | null = null;
  private generation = 0;

  constructor() {
    makeAutoObservable<EngineStore, "generation">(
      this,
      { generation: false },
      { autoBind: true },
    );
  }

  get offline(): boolean {
    return this.state === "offline";
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  get version(): string | null {
    return engineVersion(this.status);
  }

  get desktop(): string | null {
    return desktopVersion(this.status);
  }

  async load(): Promise<void> {
    const generation = ++this.generation;
    this.state = "loading";
    this.error = null;
    try {
      const status = await shellStatus<ShellStatus | null>();
      if (generation !== this.generation) {
        return;
      }
      this.status = status;
      this.state = engineReady(status) ? "ready" : "offline";
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      this.status = null;
      this.state = "offline";
      this.error = toAppError(error, "SHELL_UNAVAILABLE");
    }
  }
}
