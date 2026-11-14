import { ConfigStore } from "@/entities/config";
import { EngineStore } from "@/entities/engine/model/EngineStore";
import { ReportsStore } from "@/entities/report/model/ReportsStore";
import { StatsStore } from "@/entities/stats/model/StatsStore";
import { makeAutoObservable } from "mobx";

/**
 * One store graph for the window. Bootstrap is idempotent and reads only:
 * `shell_status` plus the read-only `stats` command.
 *
 * `config` is shared by Settings and Config so the Config diff tab sees the
 * same draft; a page-local store would always render an empty diff.
 */
export class RootStore {
  engine = new EngineStore();
  stats = new StatsStore();
  reports = new ReportsStore();
  config = new ConfigStore();
  private bootstrapped = false;

  constructor() {
    makeAutoObservable<RootStore, "bootstrapped">(
      this,
      {
        bootstrapped: false,
        engine: false,
        stats: false,
        reports: false,
        config: false,
      },
      { autoBind: true },
    );
  }

  async bootstrap(): Promise<void> {
    if (this.bootstrapped) {
      return;
    }
    this.bootstrapped = true;
    await this.engine.load();
    if (!this.engine.offline) {
      await this.stats.refresh();
    }
  }
}
