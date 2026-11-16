import { ConfigStore } from "@/entities/config";
import { EngineStore } from "@/entities/engine/model/EngineStore";
import { configMissing } from "@/entities/engine/model/types";
import { ReportsStore } from "@/entities/report/model/ReportsStore";
import { StatsStore } from "@/entities/stats/model/StatsStore";
import { UpdateStore, isPortableEngineSource } from "@/entities/update";
import {
  PropertiesStore,
  WorkspaceStore,
} from "@/entities/workspace";
import { setDesktopConfigPath } from "@/shared/desktop/settings";
import { makeAutoObservable, reaction } from "mobx";

/**
 * One store graph for the window. Bootstrap is idempotent and reads only:
 * `shell_status` plus the read-only `stats`/`properties` commands.
 *
 * `config` is shared by Settings and Config so the Config diff tab sees the
 * same draft; a page-local store would always render an empty diff.
 *
 * The active config path is the workspace identity. A new path (Settings or
 * Config file picker, recent-workspace chip, onboarding, then
 * `engine.load()`) resets stats/reports/properties before any page can show
 * numbers from the previous project.
 */
export class RootStore {
  engine = new EngineStore();
  stats = new StatsStore();
  reports = new ReportsStore();
  config = new ConfigStore();
  properties = new PropertiesStore();
  workspace = new WorkspaceStore({
    setConfigPath: async (path) => {
      await setDesktopConfigPath(path);
    },
    reloadShell: () => this.engine.load(),
    activePath: () => this.engine.status?.configPath ?? null,
    refreshStats: async () => {
      await this.stats.refresh();
    },
    configMissing: () => configMissing(this.engine.status),
  });
  update = new UpdateStore();
  private bootstrapped = false;
  private workspacePath: string | null = null;
  private stopWorkspaceWatch: () => void;

  constructor() {
    makeAutoObservable<RootStore, "bootstrapped" | "workspacePath" | "stopWorkspaceWatch">(
      this,
      {
        bootstrapped: false,
        workspacePath: false,
        stopWorkspaceWatch: false,
        engine: false,
        stats: false,
        reports: false,
        config: false,
        properties: false,
        workspace: false,
        update: false,
      },
      { autoBind: true },
    );
    this.stopWorkspaceWatch = reaction(
      () => this.engine.status?.configPath ?? null,
      (next) => {
        // The first status load only records the path; a later change is a
        // workspace switch and must not inherit the previous project's data.
        if (this.workspacePath !== null && next !== this.workspacePath) {
          this.resetWorkspaceData();
        }
        this.workspacePath = next;
        if (next) {
          this.workspace.remember({ path: next });
          void this.properties.load(next);
        }
      },
    );
  }

  /** Drop data that belongs to the previously selected workspace. */
  resetWorkspaceData(): void {
    this.stats.reset();
    this.reports.reset();
    this.properties.reset();
  }

  /** Stop the workspace watcher (tests and window teardown). */
  dispose(): void {
    this.stopWorkspaceWatch();
  }

  async bootstrap(): Promise<void> {
    if (this.bootstrapped) {
      return;
    }
    this.bootstrapped = true;
    await this.engine.load();
    // Sibling and flat resource layouts are portable ZIPs; they cannot self-update.
    this.update.setPortable(
      isPortableEngineSource(this.engine.status?.engine?.source),
    );
    this.update.setBundleKind(this.engine.status?.bundleKind ?? "unknown");
    // Startup probe only: start it before provider calls and never install on its own.
    void this.update.check({ silent: true });
    if (!this.engine.offline && this.engine.status?.configPath) {
      await this.stats.refresh();
    }
  }
}
