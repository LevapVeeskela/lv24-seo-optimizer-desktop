import type { Envelope } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";
import type { MessageKey } from "@/shared/i18n";
import type { InitProjectInput, InitProjectResult } from "@/entities/engine/api/onboarding";
import {
  deriveProjectPaths,
  type ProjectPaths,
  type WorkspaceActivation,
} from "@/entities/workspace";
import { makeAutoObservable } from "mobx";
import { mapInitError, validateSiteUrl } from "./wizard";

export interface OnboardingDeps {
  /** Shell-owned folder picker (`pick_directory`). */
  pickDirectory(): Promise<string | null>;
  /** `lv24-seo init` through the allow-listed CLI bridge. */
  initProject(input: InitProjectInput): Promise<Envelope<InitProjectResult>>;
  /** Existing settings path: persist the config and reload shell + stats. */
  activate(path: string): Promise<WorkspaceActivation>;
  /** Native `seo.toml` picker used when the shell has not approved a path. */
  pickConfig(): Promise<string | null>;
  /** Ask before discarding a dirty Settings draft for a new workspace. */
  confirmWorkspaceChange(): Promise<boolean>;
}

export type OnboardingState = "idle" | "choosing" | "creating" | "done";

/**
 * Wizard state machine. It is deliberately free of React and of the shell:
 * every side effect arrives through `OnboardingDeps`, so the flow is testable
 * without Tauri and the page only renders what this store exposes.
 */
export class OnboardingStore {
  directory: string | null = null;
  siteUrl = "";
  siteTouched = false;
  state: OnboardingState = "idle";
  error: AppError | null = null;
  result: InitProjectResult | null = null;
  private readonly deps: OnboardingDeps;
  private generation = 0;

  constructor(deps: OnboardingDeps) {
    this.deps = deps;
    makeAutoObservable<OnboardingStore, "deps" | "generation">(
      this,
      { deps: false, generation: false },
      { autoBind: true },
    );
  }

  get paths(): ProjectPaths | null {
    return this.directory ? deriveProjectPaths(this.directory) : null;
  }

  get siteErrorKey(): MessageKey | null {
    return validateSiteUrl(this.siteUrl);
  }

  get choosing(): boolean {
    return this.state === "choosing";
  }

  get creating(): boolean {
    return this.state === "creating";
  }

  get done(): boolean {
    return this.state === "done";
  }

  get exists(): boolean {
    return this.error?.code === "ONBOARDING_CONFIG_EXISTS";
  }

  get canCreate(): boolean {
    return (
      Boolean(this.directory) &&
      this.siteErrorKey === null &&
      !this.choosing &&
      !this.creating
    );
  }

  setDirectory(directory: string | null): void {
    this.directory = directory?.trim() || null;
    this.error = null;
    this.result = null;
  }

  setSiteUrl(value: string): void {
    this.siteUrl = value;
  }

  markSiteTouched(): void {
    this.siteTouched = true;
  }

  async chooseDirectory(): Promise<void> {
    const generation = ++this.generation;
    this.state = "choosing";
    this.error = null;
    try {
      const selected = await this.deps.pickDirectory();
      if (generation !== this.generation) {
        return;
      }
      if (selected) {
        this.setDirectory(selected);
      }
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      this.error = toAppError(error, "PICK_DIRECTORY");
    } finally {
      if (generation === this.generation) {
        this.state = "idle";
      }
    }
  }

  /**
   * Create the project and activate it. Returns the activated config path on
   * success; on failure the error explains which half failed (create or
   * activate) so the UI can offer the right recovery.
   */
  async create(): Promise<string | null> {
    this.markSiteTouched();
    const paths = this.paths;
    if (!paths || !this.canCreate) {
      return null;
    }
    if (!(await this.deps.confirmWorkspaceChange())) {
      return null;
    }
    const generation = ++this.generation;
    this.state = "creating";
    this.error = null;
    this.result = null;
    const result = await this.deps.initProject({
      property: this.siteUrl.trim(),
      configPath: paths.configPath,
      dataDir: paths.dataDir,
    });
    if (generation !== this.generation) {
      return null;
    }
    if (!result.ok) {
      this.error = mapInitError(result.error);
      this.state = "idle";
      return null;
    }
    this.result = result.data;
    return this.finish(paths.configPath, generation);
  }

  /** Activate `<chosenDir>/seo.toml` when `init` reported it already exists. */
  async useExisting(): Promise<string | null> {
    const paths = this.paths;
    if (!paths) {
      return null;
    }
    if (!(await this.deps.confirmWorkspaceChange())) {
      return null;
    }
    const generation = ++this.generation;
    this.state = "creating";
    this.error = null;
    return this.finish(paths.configPath, generation);
  }

  /** Native picker fallback for a path the shell has not approved yet. */
  async chooseExistingConfig(): Promise<string | null> {
    if (!(await this.deps.confirmWorkspaceChange())) {
      return null;
    }
    const generation = ++this.generation;
    this.state = "choosing";
    this.error = null;
    try {
      const selected = await this.deps.pickConfig();
      if (generation !== this.generation) {
        return null;
      }
      if (!selected) {
        this.state = "idle";
        return null;
      }
      this.state = "creating";
      return await this.finish(selected, generation);
    } catch (error) {
      if (generation !== this.generation) {
        return null;
      }
      this.error = toAppError(error, "PICK_CONFIG");
      this.state = "idle";
      return null;
    }
  }

  reset(): void {
    this.generation += 1;
    this.directory = null;
    this.siteUrl = "";
    this.siteTouched = false;
    this.state = "idle";
    this.error = null;
    this.result = null;
  }

  private async finish(
    configPath: string,
    generation: number,
  ): Promise<string | null> {
    const activation = await this.deps.activate(configPath);
    if (generation !== this.generation) {
      return null;
    }
    if (!activation.ok) {
      this.error =
        activation.error ??
        toAppError(
          { code: "WORKSPACE_NOT_ACTIVATED", message: "Activation failed." },
          "WORKSPACE_NOT_ACTIVATED",
        );
      this.state = "idle";
      return null;
    }
    this.state = "done";
    return configPath;
  }
}
