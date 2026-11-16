import type { MessageKey } from "@/shared/i18n";
import type { CliError } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";

/**
 * Accept an absolute http(s) URL, localhost for local testing, or a GSC
 * `sc-domain:` property. The engine derives the project name from this value.
 */
export function validateSiteUrl(raw: string): MessageKey | null {
  const value = raw.trim();
  if (!value) {
    return "onboarding.error.siteRequired";
  }
  if (/^sc-domain:[^\s/]+\.[^\s/]+$/i.test(value)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "onboarding.error.siteInvalid";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "onboarding.error.siteInvalid";
  }
  if (!url.hostname || url.username || url.password) {
    return "onboarding.error.siteInvalid";
  }
  return null;
}

/**
 * The engine reports an existing `seo.toml` as CONFIG_INVALID with an
 * "already exists" message. Give the wizard its own code so the UI can offer
 * "open the existing file" instead of showing a raw --force hint.
 */
export function mapInitError(error: CliError): AppError {
  if (error.code === "CONFIG_INVALID" && /already exists/i.test(error.message)) {
    return {
      code: "ONBOARDING_CONFIG_EXISTS",
      message: error.message,
      nextAction: error.next_action,
      retryable: false,
    };
  }
  return toAppError(error, "CLI_FAILED");
}
