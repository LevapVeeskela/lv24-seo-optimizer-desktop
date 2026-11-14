import { describe, expect, it } from "vitest";
import {
  LOCALE_STORAGE_KEY,
  detectLocale,
  normalizeLocale,
  persistLocale,
  translate,
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
});
