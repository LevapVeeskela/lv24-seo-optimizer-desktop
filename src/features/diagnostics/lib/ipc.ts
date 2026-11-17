import { cliRun, type Envelope } from "@/shared/cli";

/**
 * Read-only platform diagnostics over the fixed `cli_run` allow-list. Every
 * function maps form values to the exact arguments the Rust shell accepts;
 * there is no write flag, confirm token or arbitrary provider option here.
 */

function options(configPath: string | undefined): { configPath?: string } {
  return configPath ? { configPath } : {};
}

export interface GscInspectInput {
  url: string;
  language?: string;
}

export function runGscInspect(
  input: GscInspectInput,
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("gsc_inspect", {
    args: {
      url: input.url,
      ...(input.language ? { language: input.language } : {}),
    },
    ...options(configPath),
  });
}

export function runGscSitemaps(
  input: { sitemapIndex?: string },
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("gsc_sitemaps", {
    args: input.sitemapIndex ? { sitemapIndex: input.sitemapIndex } : {},
    ...options(configPath),
  });
}

export function runYandexIndexing(
  input: { dateFrom?: string; dateTo?: string },
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("yandex_indexing", {
    args: {
      ...(input.dateFrom ? { dateFrom: input.dateFrom } : {}),
      ...(input.dateTo ? { dateTo: input.dateTo } : {}),
    },
    ...options(configPath),
  });
}

export function runYandexSitemaps(
  input: { parentId?: string; limit?: number },
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("yandex_sitemaps", {
    args: {
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    },
    ...options(configPath),
  });
}

export function runYandexQueue(
  input: { limit?: number; offset?: number; dateFrom?: string; dateTo?: string },
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("yandex_queue", {
    args: {
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
      ...(input.dateFrom ? { dateFrom: input.dateFrom } : {}),
      ...(input.dateTo ? { dateTo: input.dateTo } : {}),
    },
    ...options(configPath),
  });
}

export function runBingPages(
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("bing_pages", options(configPath));
}

export function runBingTraffic(
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("bing_traffic", options(configPath));
}

export function runBingCrawl(
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("bing_crawl", options(configPath));
}

export function runBingUrlinfo(
  input: { url: string },
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("bing_urlinfo", {
    args: { url: input.url },
    ...options(configPath),
  });
}

export function runBingJoins(
  input: { query?: string; page?: string },
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("bing_joins", {
    args: {
      ...(input.query ? { query: input.query } : {}),
      ...(input.page ? { page: input.page } : {}),
    },
    ...options(configPath),
  });
}

export interface MetrikaReadInput {
  days?: number;
  lagDays?: number;
  limit?: number;
}

function metrikaArgs(input: MetrikaReadInput): Record<string, unknown> {
  return {
    ...(input.days !== undefined ? { days: input.days } : {}),
    ...(input.lagDays !== undefined ? { lagDays: input.lagDays } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  };
}

function runMetrika(
  command:
    | "metrika_pages"
    | "metrika_goals"
    | "metrika_devices"
    | "metrika_countries"
    | "metrika_engagement",
  input: MetrikaReadInput,
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>(command, {
    args: metrikaArgs(input),
    ...options(configPath),
  });
}

export function runMetrikaPages(
  input: MetrikaReadInput,
  configPath?: string,
): Promise<Envelope<unknown>> {
  return runMetrika("metrika_pages", input, configPath);
}

export function runMetrikaGoals(
  input: MetrikaReadInput,
  configPath?: string,
): Promise<Envelope<unknown>> {
  return runMetrika("metrika_goals", input, configPath);
}

export function runMetrikaDevices(
  input: MetrikaReadInput,
  configPath?: string,
): Promise<Envelope<unknown>> {
  return runMetrika("metrika_devices", input, configPath);
}

export function runMetrikaCountries(
  input: MetrikaReadInput,
  configPath?: string,
): Promise<Envelope<unknown>> {
  return runMetrika("metrika_countries", input, configPath);
}

export function runMetrikaEngagement(
  input: MetrikaReadInput,
  configPath?: string,
): Promise<Envelope<unknown>> {
  return runMetrika("metrika_engagement", input, configPath);
}

export function runMetrikaBytime(
  input: MetrikaReadInput & { group?: "day" | "week" | "month" },
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("metrika_bytime", {
    args: {
      ...metrikaArgs(input),
      ...(input.group ? { group: input.group } : {}),
    },
    ...options(configPath),
  });
}

export interface CwvAuditsInput {
  url: string;
  strategy?: "mobile" | "desktop";
  category?: Array<
    "performance" | "seo" | "accessibility" | "best-practices"
  >;
}

export function runCwvAudits(
  input: CwvAuditsInput,
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("cwv_audits", {
    args: {
      url: input.url,
      ...(input.strategy ? { strategy: input.strategy } : {}),
      ...(input.category?.length ? { category: input.category } : {}),
    },
    ...options(configPath),
  });
}

export interface CwvHistoryInput {
  url?: string;
  origin?: string;
  device?: "phone" | "desktop" | "tablet";
  weeks?: number;
}

export function runCwvHistory(
  input: CwvHistoryInput,
  configPath?: string,
): Promise<Envelope<unknown>> {
  return cliRun<unknown>("cwv_history", {
    args: {
      ...(input.url ? { url: input.url } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.device ? { device: input.device } : {}),
      ...(input.weeks !== undefined ? { weeks: input.weeks } : {}),
    },
    ...options(configPath),
  });
}
