import { describe, expect, it } from "vitest";
import { CRAWL_SEVERITIES } from "@/entities/crawl";
import { crawlCopy } from "./copy";

const LOCALES = ["en", "ru", "zh"] as const;

describe("crawlCopy", () => {
  it("keeps every locale on the same key set", () => {
    const keys = (locale: (typeof LOCALES)[number]) =>
      Object.keys(crawlCopy(locale)).sort();
    const reference = keys("en");

    for (const locale of LOCALES) {
      expect(keys(locale)).toEqual(reference);
      expect(
        Object.values(crawlCopy(locale)).every(
          (value) => typeof value !== "string" || value.trim() !== "",
        ),
      ).toBe(true);
    }
  });

  it("labels every severity in every locale", () => {
    for (const locale of LOCALES) {
      for (const severity of CRAWL_SEVERITIES) {
        expect(crawlCopy(locale).severityLabel[severity].trim()).not.toBe("");
      }
    }
  });
});
