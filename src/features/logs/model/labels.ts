import type { MessageKey } from "@/shared/i18n";
import type { LogBot, LogStatusClass } from "@/entities/logs";

/** Localized labels for the UA classes the engine can return. */
export const BOT_KEYS: Record<LogBot | "unknown", MessageKey> = {
  googlebot: "logs.bot.googlebot",
  yandexbot: "logs.bot.yandexbot",
  bingbot: "logs.bot.bingbot",
  other: "logs.bot.other",
  unknown: "logs.bot.unknown",
};

export const STATUS_KEYS: Record<LogStatusClass | "unknown", MessageKey> = {
  "2xx": "logs.status.2xx",
  "3xx": "logs.status.3xx",
  "4xx": "logs.status.4xx",
  "5xx": "logs.status.5xx",
  other: "logs.status.other",
  unknown: "logs.status.unknown",
};
