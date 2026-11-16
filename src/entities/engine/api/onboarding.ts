import { cliRun, type Envelope } from "@/shared/cli";

export interface InitProjectInput {
  /** Site URL or GSC property, for example `https://example.com`. */
  property: string;
  /** Absolute destination: `<chosenDir>/seo.toml`. */
  configPath: string;
  /** Absolute data directory: `<chosenDir>/data`. */
  dataDir: string;
}

export interface InitProjectResult {
  config_path: string;
  data_dir: string;
  overwritten: boolean;
  project: {
    name?: string;
    base_url?: string;
    default_property?: string;
  };
}

/**
 * Create `seo.toml` and the data directory without overwriting an existing
 * file. `configPath` uses the existing top-level slot (`--config`); the site
 * and data directory travel in `args` (the shell's `CliArgs`).
 */
export async function initProject(
  input: InitProjectInput,
): Promise<Envelope<InitProjectResult>> {
  return cliRun<InitProjectResult>("init", {
    configPath: input.configPath,
    args: {
      property: input.property,
      dataDir: input.dataDir,
    },
  });
}
