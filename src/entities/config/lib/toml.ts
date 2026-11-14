import {
  cloneConfig,
  defaultConfig,
  type ConfigModel,
  type PsiStrategy,
  type ReportLocale,
  type TelegramSeverity,
  type WeekStart,
} from "@/entities/config/model/types";

export interface ParseConfigResult {
  model: ConfigModel;
  unknownKeys: string[];
  warnings: string[];
}

const TABLE_PATHS = new Set([
  "project",
  "providers",
  "providers.gsc",
  "providers.yandex_webmaster",
  "providers.yandex_metrika",
  "providers.bing",
  "providers.crux",
  "providers.psi",
  "report",
  "report.thresholds",
  "report.email",
  "report.telegram",
  "crawl",
  "storage",
]);

const PROVIDER_TABLES = new Set([
  "providers.gsc",
  "providers.yandex_webmaster",
  "providers.yandex_metrika",
  "providers.bing",
  "providers.crux",
  "providers.psi",
]);

/**
 * A deliberately small TOML reader for the known `seo.toml` schema. It handles
 * comments, dotted tables, basic/literal strings, booleans, numbers, arrays and
 * inline tables. Unsupported syntax is reported as a warning instead of being
 * silently rewritten on save.
 */
export function parseConfigToml(raw: string): ParseConfigResult {
  const model = defaultConfig();
  const unknownKeys: string[] = [];
  const warnings: string[] = [];
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/);
  let table: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const withoutComment = stripComment(lines[index]).trim();
    if (!withoutComment) {
      continue;
    }

    if (withoutComment.startsWith("[")) {
      if (withoutComment.startsWith("[[")) {
        unknownKeys.push(withoutComment);
        warnings.push(`array-of-tables is not editable in the desktop: ${withoutComment}`);
        continue;
      }
      const end = withoutComment.lastIndexOf("]");
      if (end < 0) {
        warnings.push(`unterminated table header: ${withoutComment}`);
        continue;
      }
      const header = withoutComment.slice(1, end).trim();
      table = splitDottedKey(header);
      const path = table.join(".");
      if (!TABLE_PATHS.has(path)) {
        unknownKeys.push(path);
      }
      if (PROVIDER_TABLES.has(path)) {
        setProviderPresent(model, path);
      }
      continue;
    }

    const equals = indexOutsideString(withoutComment, "=");
    if (equals < 0) {
      warnings.push(`cannot read line ${index + 1}: ${withoutComment}`);
      continue;
    }

    const key = withoutComment.slice(0, equals).trim();
    const initial = withoutComment.slice(equals + 1).trim();
    const collected = collectValue(lines, index, initial);
    index = collected.nextIndex;
    const path = [...table, ...splitDottedKey(key)].join(".");
    const value = parseTomlValue(collected.text);
    if (value === undefined) {
      warnings.push(`cannot read value for ${path}`);
      continue;
    }
    assignKnown(model, path, value, unknownKeys, warnings);
  }

  return { model, unknownKeys, warnings };
}

/**
 * Serialise the known schema. Comments and unknown keys are not preserved; the
 * caller must warn the user about that before writing.
 */
export function serializeConfig(model: ConfigModel): string {
  const lines: string[] = [];
  const project = model.project;
  lines.push("[project]");
  lines.push(`name = ${tomlString(project.name)}`);
  lines.push(`base_url = ${tomlString(project.base_url)}`);
  lines.push(`default_property = ${tomlString(project.default_property)}`);

  const providers = model.providers;
  if (shouldEmitProvider(providers.gsc)) {
    lines.push("", "[providers.gsc]");
    lines.push(`property = ${tomlString(providers.gsc.property)}`);
    if (providers.gsc.auth.trim()) {
      lines.push(`auth = ${tomlString(providers.gsc.auth)}`);
    }
  }
  if (shouldEmitProvider(providers.yandex_webmaster)) {
    lines.push("", "[providers.yandex_webmaster]");
    lines.push(`host_id = ${tomlString(providers.yandex_webmaster.host_id)}`);
  }
  if (shouldEmitProvider(providers.yandex_metrika)) {
    lines.push("", "[providers.yandex_metrika]");
    lines.push(`counter = ${tomlString(providers.yandex_metrika.counter)}`);
    if (providers.yandex_metrika.goals.length) {
      lines.push(`goals = ${tomlNumberArray(providers.yandex_metrika.goals)}`);
    }
  }
  if (shouldEmitProvider(providers.bing)) {
    lines.push("", "[providers.bing]");
    lines.push(`site = ${tomlString(providers.bing.site)}`);
  }
  if (shouldEmitProvider(providers.crux)) {
    lines.push("", "[providers.crux]");
    lines.push(`origin = ${tomlString(providers.crux.origin)}`);
  }
  if (shouldEmitProvider(providers.psi)) {
    lines.push("", "[providers.psi]");
    lines.push(`strategy = ${tomlString(providers.psi.strategy)}`);
    lines.push(`urls = ${tomlStringArray(providers.psi.urls)}`);
  }

  const report = model.report;
  lines.push("", "[report]");
  lines.push(`locale = ${tomlString(report.locale)}`);
  lines.push(`timezone = ${tomlString(report.timezone)}`);
  lines.push(`week_start = ${tomlString(report.week_start)}`);
  lines.push("", "[report.thresholds]");
  lines.push(`clicks_pct = ${tomlNumber(report.thresholds.clicks_pct)}`);
  lines.push(`impressions_pct = ${tomlNumber(report.thresholds.impressions_pct)}`);
  lines.push(`position_abs = ${tomlNumber(report.thresholds.position_abs)}`);
  lines.push("", "[report.email]");
  lines.push(`enabled = ${tomlBool(report.email.enabled)}`);
  lines.push(`to = ${tomlStringArray(report.email.to)}`);
  lines.push(`from = ${tomlString(report.email.from)}`);
  lines.push(`only_on_change = ${tomlBool(report.email.only_on_change)}`);
  lines.push(`smtp_host = ${tomlString(report.email.smtp_host)}`);
  lines.push(`smtp_port = ${tomlNumber(report.email.smtp_port)}`);
  lines.push(`smtp_user = ${tomlString(report.email.smtp_user)}`);
  lines.push("", "[report.telegram]");
  lines.push(`enabled = ${tomlBool(report.telegram.enabled)}`);
  lines.push(`chat_id = ${tomlString(report.telegram.chat_id)}`);
  lines.push(`severity = ${tomlString(report.telegram.severity)}`);

  const crawl = model.crawl;
  lines.push("", "[crawl]");
  lines.push(`max_urls = ${tomlNumber(crawl.max_urls)}`);
  lines.push(`concurrency = ${tomlNumber(crawl.concurrency)}`);
  lines.push(`respect_robots = ${tomlBool(crawl.respect_robots)}`);
  lines.push(`user_agent = ${tomlString(crawl.user_agent)}`);

  const storage = model.storage;
  lines.push("", "[storage]");
  lines.push(`data_dir = ${tomlString(storage.data_dir)}`);
  lines.push(`raw_retention_days = ${tomlNumber(storage.raw_retention_days)}`);

  return `${lines.join("\n")}\n`;
}

function shouldEmitProvider(entry: { present: boolean }): boolean {
  return entry.present;
}

function assignKnown(
  model: ConfigModel,
  path: string,
  value: unknown,
  unknownKeys: string[],
  warnings: string[],
): void {
  if (isPlainObject(value) && TABLE_PATHS.has(path)) {
    if (PROVIDER_TABLES.has(path)) {
      setProviderPresent(model, path);
    }
    for (const [key, child] of Object.entries(value)) {
      assignKnown(model, `${path}.${key}`, child, unknownKeys, warnings);
    }
    return;
  }

  const string = (): string | null => (typeof value === "string" ? value : null);
  const number = (): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const integer = (): number | null => {
    const parsed = number();
    return parsed !== null && Number.isInteger(parsed) ? parsed : null;
  };
  const bool = (): boolean | null => (typeof value === "boolean" ? value : null);
  const strings = (): string[] | null =>
    Array.isArray(value) && value.every((item) => typeof item === "string")
      ? (value as string[])
      : null;
  const numbers = (): number[] | null =>
    Array.isArray(value) &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
      ? (value as number[])
      : null;

  const assign = (apply: () => void): void => apply();
  const fail = (): void => {
    warnings.push(`value for ${path} has an unsupported type`);
  };

  switch (path) {
    case "project.name":
      return assign(() => setString(model.project, "name", string, fail));
    case "project.base_url":
      return assign(() => setString(model.project, "base_url", string, fail));
    case "project.default_property":
      return assign(() =>
        setString(model.project, "default_property", string, fail),
      );
    case "providers.gsc.property":
      model.providers.gsc.present = true;
      return assign(() =>
        setString(model.providers.gsc, "property", string, fail),
      );
    case "providers.gsc.auth":
      model.providers.gsc.present = true;
      return assign(() => setString(model.providers.gsc, "auth", string, fail));
    case "providers.yandex_webmaster.host_id":
      model.providers.yandex_webmaster.present = true;
      return assign(() =>
        setString(model.providers.yandex_webmaster, "host_id", string, fail),
      );
    case "providers.yandex_metrika.counter": {
      model.providers.yandex_metrika.present = true;
      // The engine accepts an unquoted counter id and normalises it to a string.
      const parsed =
        string() ??
        (typeof value === "number" && Number.isFinite(value)
          ? String(value)
          : null);
      return parsed !== null
        ? assign(() => {
            model.providers.yandex_metrika.counter = parsed;
          })
        : fail();
    }
    case "providers.yandex_metrika.goals": {
      model.providers.yandex_metrika.present = true;
      const parsed = numbers();
      return parsed ? assign(() => {
        model.providers.yandex_metrika.goals = parsed;
      }) : fail();
    }
    case "providers.bing.site":
      model.providers.bing.present = true;
      return assign(() => setString(model.providers.bing, "site", string, fail));
    case "providers.crux.origin":
      model.providers.crux.present = true;
      return assign(() =>
        setString(model.providers.crux, "origin", string, fail),
      );
    case "providers.psi.strategy": {
      model.providers.psi.present = true;
      const parsed = string();
      if (parsed === "mobile" || parsed === "desktop") {
        model.providers.psi.strategy = parsed satisfies PsiStrategy;
      } else {
        fail();
      }
      return;
    }
    case "providers.psi.urls": {
      model.providers.psi.present = true;
      const parsed = strings();
      return parsed
        ? assign(() => {
            model.providers.psi.urls = parsed;
          })
        : fail();
    }
    case "report.locale": {
      const parsed = string();
      if (parsed === "ru" || parsed === "en" || parsed === "zh") {
        model.report.locale = parsed satisfies ReportLocale;
      } else {
        fail();
      }
      return;
    }
    case "report.timezone":
      return assign(() => setString(model.report, "timezone", string, fail));
    case "report.week_start": {
      const parsed = string();
      if (parsed === "monday" || parsed === "sunday") {
        model.report.week_start = parsed satisfies WeekStart;
      } else {
        fail();
      }
      return;
    }
    case "report.thresholds.clicks_pct": {
      const parsed = number();
      return parsed !== null
        ? assign(() => {
            model.report.thresholds.clicks_pct = parsed;
          })
        : fail();
    }
    case "report.thresholds.impressions_pct": {
      const parsed = number();
      return parsed !== null
        ? assign(() => {
            model.report.thresholds.impressions_pct = parsed;
          })
        : fail();
    }
    case "report.thresholds.position_abs": {
      const parsed = number();
      return parsed !== null
        ? assign(() => {
            model.report.thresholds.position_abs = parsed;
          })
        : fail();
    }
    case "report.email.enabled":
      return assign(() => setBool(model.report.email, "enabled", bool, fail));
    case "report.email.to": {
      const parsed = strings();
      return parsed
        ? assign(() => {
            model.report.email.to = parsed;
          })
        : fail();
    }
    case "report.email.from":
      return assign(() => setString(model.report.email, "from", string, fail));
    case "report.email.only_on_change":
      return assign(() =>
        setBool(model.report.email, "only_on_change", bool, fail),
      );
    case "report.email.smtp_host":
      return assign(() =>
        setString(model.report.email, "smtp_host", string, fail),
      );
    case "report.email.smtp_port": {
      const parsed = integer();
      return parsed !== null
        ? assign(() => {
            model.report.email.smtp_port = parsed;
          })
        : fail();
    }
    case "report.email.smtp_user":
      return assign(() =>
        setString(model.report.email, "smtp_user", string, fail),
      );
    case "report.telegram.enabled":
      return assign(() =>
        setBool(model.report.telegram, "enabled", bool, fail),
      );
    case "report.telegram.chat_id":
      return assign(() =>
        setString(model.report.telegram, "chat_id", string, fail),
      );
    case "report.telegram.severity": {
      const parsed = string();
      if (parsed === "critical" || parsed === "all") {
        model.report.telegram.severity = parsed satisfies TelegramSeverity;
      } else {
        fail();
      }
      return;
    }
    case "crawl.max_urls": {
      const parsed = integer();
      return parsed !== null
        ? assign(() => {
            model.crawl.max_urls = parsed;
          })
        : fail();
    }
    case "crawl.concurrency": {
      const parsed = integer();
      return parsed !== null
        ? assign(() => {
            model.crawl.concurrency = parsed;
          })
        : fail();
    }
    case "crawl.respect_robots":
      return assign(() => setBool(model.crawl, "respect_robots", bool, fail));
    case "crawl.user_agent":
      return assign(() => setString(model.crawl, "user_agent", string, fail));
    case "storage.data_dir":
      return assign(() => setString(model.storage, "data_dir", string, fail));
    case "storage.raw_retention_days": {
      const parsed = integer();
      return parsed !== null
        ? assign(() => {
            model.storage.raw_retention_days = parsed;
          })
        : fail();
    }
    default:
      unknownKeys.push(path);
  }
}

function setString<T extends object, K extends keyof T>(
  target: T,
  key: K,
  read: () => string | null,
  fail: () => void,
): void {
  const value = read();
  if (value === null) {
    fail();
    return;
  }
  target[key] = value as T[K];
}

function setBool<T extends object, K extends keyof T>(
  target: T,
  key: K,
  read: () => boolean | null,
  fail: () => void,
): void {
  const value = read();
  if (value === null) {
    fail();
    return;
  }
  target[key] = value as T[K];
}

function setProviderPresent(model: ConfigModel, table: string): void {
  switch (table) {
    case "providers.gsc":
      model.providers.gsc.present = true;
      break;
    case "providers.yandex_webmaster":
      model.providers.yandex_webmaster.present = true;
      break;
    case "providers.yandex_metrika":
      model.providers.yandex_metrika.present = true;
      break;
    case "providers.bing":
      model.providers.bing.present = true;
      break;
    case "providers.crux":
      model.providers.crux.present = true;
      break;
    case "providers.psi":
      model.providers.psi.present = true;
      break;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripComment(line: string): string {
  let basic = false;
  let literal = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (basic) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        basic = false;
      }
      continue;
    }
    if (literal) {
      if (char === "'") {
        literal = false;
      }
      continue;
    }
    if (char === '"') {
      basic = true;
    } else if (char === "'") {
      literal = true;
    } else if (char === "#") {
      return line.slice(0, index);
    }
  }
  return line;
}

function indexOutsideString(line: string, needle: string): number {
  let basic = false;
  let literal = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (basic) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        basic = false;
      }
      continue;
    }
    if (literal) {
      if (char === "'") {
        literal = false;
      }
      continue;
    }
    if (char === '"') {
      basic = true;
    } else if (char === "'") {
      literal = true;
    } else if (char === needle) {
      return index;
    }
  }
  return -1;
}

function splitDottedKey(raw: string): string[] {
  const parts: string[] = [];
  let current = "";
  let basic = false;
  let literal = false;
  let escaped = false;
  for (const char of raw.trim()) {
    if (basic) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        basic = false;
      }
      continue;
    }
    if (literal) {
      current += char;
      if (char === "'") {
        literal = false;
      }
      continue;
    }
    if (char === '"') {
      basic = true;
      current += char;
    } else if (char === "'") {
      literal = true;
      current += char;
    } else if (char === ".") {
      parts.push(unquoteKey(current.trim()));
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    parts.push(unquoteKey(current.trim()));
  }
  return parts.filter(Boolean);
}

function unquoteKey(raw: string): string {
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function collectValue(
  lines: string[],
  startIndex: number,
  initial: string,
): { text: string; nextIndex: number } {
  let text = initial;
  let index = startIndex;
  while (index < lines.length - 1 && !isValueComplete(text)) {
    index += 1;
    text += `\n${stripComment(lines[index])}`;
  }
  return { text: text.trim(), nextIndex: index };
}

function isValueComplete(text: string): boolean {
  let basic = false;
  let literal = false;
  let escaped = false;
  let depth = 0;
  for (const char of text) {
    if (basic) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        basic = false;
      }
      continue;
    }
    if (literal) {
      if (char === "'") {
        literal = false;
      }
      continue;
    }
    if (char === '"') {
      basic = true;
    } else if (char === "'") {
      literal = true;
    } else if (char === "[" || char === "{") {
      depth += 1;
    } else if (char === "]" || char === "}") {
      depth -= 1;
    }
  }
  return !basic && !literal && depth <= 0;
}

export function parseTomlValue(raw: string): unknown {
  const text = raw.trim();
  if (!text) {
    return undefined;
  }
  if (text.startsWith('"')) {
    return parseBasicString(text);
  }
  if (text.startsWith("'")) {
    return parseLiteralString(text);
  }
  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }
  if (text.startsWith("[")) {
    return parseArray(text);
  }
  if (text.startsWith("{")) {
    return parseInlineTable(text);
  }
  const number = text.replace(/_/g, "");
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(number)) {
    return Number(number);
  }
  return undefined;
}

function parseBasicString(text: string): string | undefined {
  if (text.startsWith('"""')) {
    const end = text.indexOf('"""', 3);
    if (end < 0) {
      return undefined;
    }
    return unescapeBasic(text.slice(3, end));
  }
  let escaped = false;
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === '"') {
      return unescapeBasic(text.slice(1, index));
    }
  }
  return undefined;
}

function parseLiteralString(text: string): string | undefined {
  if (text.startsWith("'''")) {
    const end = text.indexOf("'''", 3);
    return end < 0 ? undefined : text.slice(3, end);
  }
  const end = text.indexOf("'", 1);
  return end < 0 ? undefined : text.slice(1, end);
}

function unescapeBasic(value: string): string {
  return value.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_match, code: string) => {
    switch (code) {
      case "b":
        return "\b";
      case "t":
        return "\t";
      case "n":
        return "\n";
      case "f":
        return "\f";
      case "r":
        return "\r";
      case '"':
        return '"';
      case "\\":
        return "\\";
      default:
        if (code.startsWith("u") || code.startsWith("U")) {
          const point = Number.parseInt(code.slice(1), 16);
          return Number.isFinite(point) ? String.fromCodePoint(point) : code;
        }
        return code;
    }
  });
}

function parseArray(text: string): unknown[] | undefined {
  const inner = text.slice(1, text.lastIndexOf("]"));
  if (!inner.trim()) {
    return [];
  }
  const parts = splitTopLevel(inner, ",");
  const values: unknown[] = [];
  for (const part of parts) {
    if (!part.trim()) {
      continue;
    }
    const value = parseTomlValue(part);
    if (value === undefined) {
      return undefined;
    }
    values.push(value);
  }
  return values;
}

function parseInlineTable(text: string): Record<string, unknown> | undefined {
  const inner = text.slice(1, text.lastIndexOf("}"));
  const result: Record<string, unknown> = {};
  for (const part of splitTopLevel(inner, ",")) {
    if (!part.trim()) {
      continue;
    }
    const equals = indexOutsideString(part, "=");
    if (equals < 0) {
      return undefined;
    }
    const key = unquoteKey(part.slice(0, equals).trim());
    const value = parseTomlValue(part.slice(equals + 1));
    if (!key || value === undefined) {
      return undefined;
    }
    result[key] = value;
  }
  return result;
}

function splitTopLevel(raw: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let basic = false;
  let literal = false;
  let escaped = false;
  let depth = 0;
  for (const char of raw) {
    if (basic) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        basic = false;
      }
      continue;
    }
    if (literal) {
      current += char;
      if (char === "'") {
        literal = false;
      }
      continue;
    }
    if (char === '"') {
      basic = true;
      current += char;
    } else if (char === "'") {
      literal = true;
      current += char;
    } else if (char === "[" || char === "{") {
      depth += 1;
      current += char;
    } else if (char === "]" || char === "}") {
      depth -= 1;
      current += char;
    } else if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function tomlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

function tomlNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return String(value);
}

function tomlBool(value: boolean): string {
  return value ? "true" : "false";
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlNumberArray(values: readonly number[]): string {
  return `[${values.map(tomlNumber).join(", ")}]`;
}

/** Exposed for the diff/serializer tests without leaking the internal parser. */
export function roundTripConfig(model: ConfigModel): ConfigModel {
  return parseConfigToml(serializeConfig(model)).model;
}

/** Kept next to the parser so a cloned model is never mutated by callers. */
export function readConfigModel(model: ConfigModel): ConfigModel {
  return cloneConfig(model);
}
