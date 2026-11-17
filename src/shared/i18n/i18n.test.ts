import { describe, expect, it } from "vitest";
import {
  LOCALES,
  LOCALE_STORAGE_KEY,
  detectLocale,
  normalizeLocale,
  persistLocale,
  translate,
  type MessageKey,
} from "./index";
import { en } from "./messages/en";
import { ru } from "./messages/ru";
import { zh } from "./messages/zh";

describe("i18n", () => {
  it("keeps every locale in sync with the English keys", () => {
    const expected = Object.keys(en).sort();
    expect(Object.keys(ru).sort()).toEqual(expected);
    expect(Object.keys(zh).sort()).toEqual(expected);
  });

  it("keeps placeholders in sync across locales", () => {
    const placeholders = (template: string): string[] =>
      [...template.matchAll(/\{(\w+)\}/g)]
        .map((match) => match[1])
        .sort();

    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      const expected = placeholders(en[key]);
      expect(placeholders(ru[key]), `ru ${key}`).toEqual(expected);
      expect(placeholders(zh[key]), `zh ${key}`).toEqual(expected);
    }
  });

  it("keeps Metrika a separate provider from Webmaster in every locale", () => {
    for (const locale of LOCALES) {
      expect(translate(locale, "secrets.provider.metrika")).not.toBe(
        translate(locale, "secrets.provider.yandex"),
      );
    }
  });

  it("states that desktop and CLI share one keychain entry", () => {
    for (const locale of LOCALES) {
      const hint = translate(locale, "secrets.sharedHint");
      expect(hint).toContain("lv24-seo");
      expect(hint.length).toBeGreaterThan(40);
    }
  });

  it("does not keep stale 0.2.0 release claims in UI copy", () => {
    for (const locale of LOCALES) {
      for (const value of Object.values(
        locale === "en" ? en : locale === "ru" ? ru : zh,
      )) {
        expect(value).not.toContain("0.2.0");
      }
    }
  });

  it("interpolates parameters in every locale", () => {
    expect(
      translate("en", "dashboard.period", {
        start: "2026-11-07",
        end: "2026-11-13",
      }),
    ).toBe("Period 2026-11-07 – 2026-11-13");
    expect(translate("ru", "service.dataAge", { days: 2 })).toBe(
      "Возраст данных 2 дн.",
    );
    expect(translate("zh", "delta.percentPoints", { value: "+0.42" })).toBe(
      "+0.42 个百分点",
    );
  });

  it("normalizes language tags and prefers the stored locale", () => {
    expect(normalizeLocale("ru-RU")).toBe("ru");
    expect(normalizeLocale("zh-Hans-CN")).toBe("zh");
    expect(normalizeLocale("en_US")).toBe("en");
    expect(normalizeLocale("de-DE")).toBeNull();

    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    persistLocale("zh", adapter);
    expect(storage.get(LOCALE_STORAGE_KEY)).toBe("zh");
    expect(detectLocale(adapter, "ru-RU")).toBe("zh");
    expect(detectLocale(null, "ru-RU")).toBe("ru");
    expect(detectLocale(null, "fr-FR")).toBe("en");
  });

  it("keeps recommendation task copy present and translated in every locale", () => {
    const keys = Object.keys(en).filter((key) =>
      key.startsWith("recommendations.task."),
    ) as Array<keyof typeof en>;
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      for (const messages of [en, ru, zh]) {
        expect(messages[key].trim(), key).not.toBe("");
      }
    }
    // Representative task copy must be translated, not copied from English.
    expect(ru["recommendations.task.opportunity.decay.title"]).toContain("клики");
    expect(zh["recommendations.task.opportunity.decay.title"]).toContain("点击");
    expect(ru["recommendations.task.limitation.title"]).toContain("Ограничение");
    expect(zh["recommendations.task.crawl.action"]).not.toBe(
      en["recommendations.task.crawl.action"],
    );
  });

  it("has a localized label for every provider origin", () => {
    const origins = [
      "gsc",
      "yandex_webmaster",
      "yandex_metrika",
      "bing",
      "crux",
      "psi",
      "crawl",
      "report",
      "stats",
    ];
    for (const origin of origins) {
      const key = `recommendations.provider.${origin}` as MessageKey;
      for (const locale of LOCALES) {
        expect(translate(locale, key).trim(), `${locale} ${key}`).not.toBe("");
      }
    }
  });

  it("labels Bing quota as remaining and submission as accepted", () => {
    expect(translate("en", "indexing.quota.daily")).toContain("remaining");
    expect(translate("ru", "indexing.quota.daily")).toContain("Осталось");
    expect(translate("zh", "indexing.quota.daily")).toContain("剩余");
    expect(translate("en", "indexing.bing.acceptedNote")).toContain(
      "not indexed",
    );
    expect(translate("ru", "indexing.bing.acceptedNote")).toContain(
      "не индексация",
    );
    expect(translate("zh", "indexing.bing.acceptedNote")).toContain(
      "不代表已收录",
    );
    for (const locale of LOCALES) {
      expect(translate(locale, "indexing.quota.daily")).not.toBe(
        translate(locale, "indexing.quota.monthly"),
      );
    }
  });
});
