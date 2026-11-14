import { getConfigValue } from "@/entities/config/lib/model";
import type { ConfigModel } from "@/entities/config/model/types";

export type EnvironmentKind = "value" | "secret" | "flag";

export type EnvironmentStatus =
  | "detected"
  | "notDetected"
  | "unknown"
  | "secret";

export interface EnvironmentEntry {
  name: string;
  path: string | null;
  kind: EnvironmentKind;
  status: EnvironmentStatus;
}

interface KnownVariable {
  name: string;
  path?: string;
  kind: EnvironmentKind;
}

/**
 * Known engine variables from `lv24_seo.core.config` and the configuration
 * contract. The shell does not expose the process environment, so presence is
 * inferred by comparing the effective config with the source file; a value that
 * matches may still be an override with the same value, hence "unknown".
 */
const KNOWN_VARIABLES: readonly KnownVariable[] = [
  { name: "LV24_SEO_DATA_DIR", path: "storage.data_dir", kind: "value" },
  { name: "LV24_SEO_GSC_PROPERTY", path: "providers.gsc.property", kind: "value" },
  {
    name: "LV24_SEO_YANDEX_HOST_ID",
    path: "providers.yandex_webmaster.host_id",
    kind: "value",
  },
  {
    name: "LV24_SEO_YANDEX_METRIKA_COUNTER",
    path: "providers.yandex_metrika.counter",
    kind: "value",
  },
  {
    name: "LV24_SEO_SMTP_HOST",
    path: "report.email.smtp_host",
    kind: "value",
  },
  {
    name: "LV24_SEO_SMTP_USER",
    path: "report.email.smtp_user",
    kind: "value",
  },
  { name: "LV24_SEO_SMTP_FROM", path: "report.email.from", kind: "value" },
  { name: "LV24_SEO_SMTP_PORT", path: "report.email.smtp_port", kind: "value" },
  { name: "LV24_SEO_MAIL_TO", path: "report.email.to", kind: "value" },
  {
    name: "LV24_SEO_TELEGRAM_CHAT_ID",
    path: "report.telegram.chat_id",
    kind: "value",
  },
  { name: "LV24_SEO_REPORT_LOCALE", path: "report.locale", kind: "value" },
  {
    name: "LV24_SEO_REPORT_TIMEZONE",
    path: "report.timezone",
    kind: "value",
  },
  { name: "LV24_SEO_GSC_CLIENT_ID", kind: "secret" },
  { name: "LV24_SEO_GSC_CLIENT_SECRET", kind: "secret" },
  { name: "LV24_SEO_GSC_SERVICE_ACCOUNT_FILE", kind: "secret" },
  { name: "LV24_SEO_YANDEX_WEBMASTER_TOKEN", kind: "secret" },
  { name: "LV24_SEO_YANDEX_METRIKA_TOKEN", kind: "secret" },
  { name: "LV24_SEO_BING_API_KEY", kind: "secret" },
  { name: "LV24_SEO_INDEXNOW_KEY", kind: "secret" },
  { name: "LV24_SEO_CRUX_API_KEY", kind: "secret" },
  { name: "LV24_SEO_PSI_API_KEY", kind: "secret" },
  { name: "LV24_SEO_SMTP_PASSWORD", kind: "secret" },
  { name: "LV24_SEO_TELEGRAM_BOT_TOKEN", kind: "secret" },
  { name: "LV24_SEO_LOG_LEVEL", kind: "flag" },
  { name: "LV24_SEO_ALLOW_FILE_SECRETS", kind: "flag" },
  { name: "LV24_SEO_BIN", kind: "flag" },
];

export function environmentEntries(
  source: ConfigModel | null,
  effective: Record<string, unknown> | null,
): EnvironmentEntry[] {
  return KNOWN_VARIABLES.map((variable) => {
    if (variable.kind === "secret") {
      return {
        name: variable.name,
        path: null,
        kind: variable.kind,
        status: "secret",
      };
    }
    if (variable.kind === "flag" || !variable.path) {
      return {
        name: variable.name,
        path: null,
        kind: variable.kind,
        status: "unknown",
      };
    }
    if (!source || !effective) {
      return {
        name: variable.name,
        path: variable.path,
        kind: variable.kind,
        status: "unknown",
      };
    }
    const sourceValue = getConfigValue(source, variable.path);
    const effectiveValue = getEffectiveValue(effective, variable.path);
    if (isEmpty(sourceValue) || effectiveValue === undefined) {
      return {
        name: variable.name,
        path: variable.path,
        kind: variable.kind,
        status: "unknown",
      };
    }
    const same = JSON.stringify(sourceValue) === JSON.stringify(effectiveValue);
    // Equal values can still be an environment override with the same value;
    // only a difference proves the override.
    return {
      name: variable.name,
      path: variable.path,
      kind: variable.kind,
      status: same ? "unknown" : "detected",
    };
  });
}

function getEffectiveValue(
  effective: Record<string, unknown>,
  path: string,
): unknown {
  let cursor: unknown = effective;
  for (const part of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return !value.trim();
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}
