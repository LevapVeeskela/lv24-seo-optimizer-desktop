import type { MessageKey } from "@/shared/i18n";
import { isRecord, stringValue } from "@/shared/lib/format";

/** `lv24-seo properties --json` data, normalized for the dashboard panel. */
export interface PropertiesProject {
  name: string | null;
  baseUrl: string | null;
  defaultProperty: string | null;
}

export type PropertyTokenState =
  | "present"
  | "missing"
  | "not_required"
  | "unknown";

export interface PropertyRow {
  provider: string;
  target: string | null;
  configured: boolean;
  requiresToken: boolean;
  token: PropertyTokenState;
  ready: boolean;
}

export interface PropertiesView {
  project: PropertiesProject;
  rows: PropertyRow[];
  configuredCount: number;
  readyCount: number;
}

const PROVIDER_KEYS: Record<string, MessageKey> = {
  gsc: "recommendations.provider.gsc",
  yandex_webmaster: "recommendations.provider.yandex_webmaster",
  yandex_metrika: "recommendations.provider.yandex_metrika",
  bing: "recommendations.provider.bing",
  crux: "recommendations.provider.crux",
  psi: "recommendations.provider.psi",
};

export function providerLabelKey(provider: string): MessageKey | null {
  return PROVIDER_KEYS[provider] ?? null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function tokenState(entry: Record<string, unknown>, requiresToken: boolean): PropertyTokenState {
  if (!requiresToken) {
    return "not_required";
  }
  if (typeof entry.token_present === "boolean") {
    return entry.token_present ? "present" : "missing";
  }
  const token = stringValue(entry.token);
  if (token === "present") {
    return "present";
  }
  if (token === "missing") {
    return "missing";
  }
  return "unknown";
}

/**
 * Map the engine payload without inventing values. A malformed row is
 * skipped; a missing token flag stays "unknown" instead of "missing".
 */
export function mapProperties(data: unknown): PropertiesView {
  const payload = isRecord(data) ? data : {};
  const project = isRecord(payload.project) ? payload.project : {};
  const providers = Array.isArray(payload.providers) ? payload.providers : [];
  const rows: PropertyRow[] = [];
  for (const item of providers) {
    if (!isRecord(item)) {
      continue;
    }
    const provider = stringValue(item.provider)?.trim();
    if (!provider) {
      continue;
    }
    const requiresToken = item.requires_token !== false;
    const configured = bool(item.configured);
    rows.push({
      provider,
      target: stringValue(item.target)?.trim() || null,
      configured,
      requiresToken,
      token: tokenState(item, requiresToken),
      ready: bool(item.ready),
    });
  }
  return {
    project: {
      name: stringValue(project.name)?.trim() || null,
      baseUrl: stringValue(project.base_url)?.trim() || null,
      defaultProperty: stringValue(project.default_property)?.trim() || null,
    },
    rows,
    configuredCount: rows.filter((row) => row.configured).length,
    readyCount: rows.filter((row) => row.ready).length,
  };
}
