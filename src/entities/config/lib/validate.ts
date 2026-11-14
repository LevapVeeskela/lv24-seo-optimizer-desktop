import type { ConfigModel, ValidationIssue } from "@/entities/config/model/types";

export interface LocalValidation {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

function issue(
  path: string,
  key: ValidationIssue["messageKey"],
  message: string,
  params?: ValidationIssue["params"],
): ValidationIssue {
  return { path, message, messageKey: key, params };
}

/**
 * Field-level checks the desktop can run before asking the engine. The engine
 * remains authoritative: `config_validate` still runs on every save and can
 * reject unknown keys or schema changes this model does not know about.
 */
export function validateConfig(model: ConfigModel): LocalValidation {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const report = model.report;
  const email = report.email;
  const telegram = report.telegram;
  const crawl = model.crawl;
  const storage = model.storage;

  if (model.project.base_url.trim()) {
    const value = model.project.base_url.trim();
    let valid = false;
    try {
      const url = new URL(value);
      valid = url.protocol === "http:" || url.protocol === "https:";
    } catch {
      valid = false;
    }
    if (!valid) {
      errors.push(
        issue(
          "project.base_url",
          "settings.validation.baseUrl",
          "Use an absolute http(s) URL.",
        ),
      );
    }
  }

  if (report.locale !== "ru" && report.locale !== "en" && report.locale !== "zh") {
    errors.push(
      issue(
        "report.locale",
        "settings.validation.locale",
        "Locale must be ru, en or zh.",
      ),
    );
  }
  if (!report.timezone.trim()) {
    errors.push(
      issue(
        "report.timezone",
        "settings.validation.timezone",
        "Timezone must not be empty.",
      ),
    );
  }
  if (report.week_start !== "monday" && report.week_start !== "sunday") {
    errors.push(
      issue(
        "report.week_start",
        "settings.validation.weekStart",
        "Week start must be monday or sunday.",
      ),
    );
  }
  if (
    telegram.severity !== "critical" &&
    telegram.severity !== "all"
  ) {
    errors.push(
      issue(
        "report.telegram.severity",
        "settings.validation.telegramSeverity",
        "Telegram severity must be critical or all.",
      ),
    );
  }
  if (
    model.providers.psi.strategy !== "mobile" &&
    model.providers.psi.strategy !== "desktop"
  ) {
    errors.push(
      issue(
        "providers.psi.strategy",
        "settings.validation.psiStrategy",
        "PSI strategy must be mobile or desktop.",
      ),
    );
  }

  const thresholds: Array<[string, number]> = [
    ["report.thresholds.clicks_pct", report.thresholds.clicks_pct],
    ["report.thresholds.impressions_pct", report.thresholds.impressions_pct],
    ["report.thresholds.position_abs", report.thresholds.position_abs],
  ];
  for (const [path, value] of thresholds) {
    if (!Number.isFinite(value) || value < 0) {
      errors.push(
        issue(
          path,
          "settings.validation.nonNegative",
          "Threshold must be zero or greater.",
        ),
      );
    }
  }

  if (
    !Number.isInteger(email.smtp_port) ||
    email.smtp_port < 1 ||
    email.smtp_port > 65535
  ) {
    errors.push(
      issue(
        "report.email.smtp_port",
        "settings.validation.port",
        "Port must be a whole number between 1 and 65535.",
      ),
    );
  }

  if (!Number.isInteger(crawl.max_urls) || crawl.max_urls < 1) {
    errors.push(
      issue(
        "crawl.max_urls",
        "settings.validation.maxUrls",
        "Max URLs must be a whole number of at least 1.",
      ),
    );
  }
  if (!Number.isInteger(crawl.concurrency) || crawl.concurrency < 1) {
    errors.push(
      issue(
        "crawl.concurrency",
        "settings.validation.concurrency",
        "Concurrency must be a whole number of at least 1.",
      ),
    );
  }
  if (
    !Number.isInteger(storage.raw_retention_days) ||
    storage.raw_retention_days < 0
  ) {
    errors.push(
      issue(
        "storage.raw_retention_days",
        "settings.validation.retention",
        "Raw retention must be zero or greater.",
      ),
    );
  }
  if (!storage.data_dir.trim()) {
    warnings.push(
      issue(
        "storage.data_dir",
        "settings.validation.dataDir",
        "Data directory is empty; the engine will resolve it from its working directory.",
      ),
    );
  }

  if (email.enabled) {
    if (!email.to.length) {
      warnings.push(
        issue(
          "report.email.to",
          "settings.validation.emailRecipients",
          "Email is enabled but has no recipients.",
        ),
      );
    }
    if (!email.smtp_host.trim()) {
      warnings.push(
        issue(
          "report.email.smtp_host",
          "settings.validation.emailHost",
          "Email is enabled but the SMTP host is empty.",
        ),
      );
    }
    if (!email.from.trim()) {
      warnings.push(
        issue(
          "report.email.from",
          "settings.validation.emailFrom",
          "Email is enabled but the sender address is empty.",
        ),
      );
    }
  }
  if (telegram.enabled && !telegram.chat_id.trim()) {
    warnings.push(
      issue(
        "report.telegram.chat_id",
        "settings.validation.telegramChat",
        "Telegram is enabled but the chat id is empty.",
      ),
    );
  }

  if (model.providers.psi.present && !model.providers.psi.urls.length) {
    warnings.push(
      issue(
        "providers.psi.urls",
        "settings.validation.psiUrls",
        "PSI is configured but the URL list is empty.",
      ),
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}
