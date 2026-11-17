import { describe, expect, it } from "vitest";
import { en } from "@/shared/i18n/messages/en";
import { NAV_ITEMS } from "./layout/AppNav";
import { ROUTES } from "./routes";

describe("routes and navigation", () => {
  it("declares the crawl, integrations and onboarding routes", () => {
    expect(ROUTES.crawl).toBe("/crawl");
    expect(ROUTES.integrations).toBe("/integrations");
    expect(ROUTES.onboarding).toBe("/onboarding");
  });

  it("declares the logs and tasks routes", () => {
    expect(ROUTES.logs).toBe("/logs");
    expect(ROUTES.tasks).toBe("/tasks");
  });

  it("links every nav item to a declared route and a translated label", () => {
    const paths = Object.values(ROUTES) as string[];
    for (const item of NAV_ITEMS) {
      expect(paths).toContain(item.to);
      expect(en[item.key].trim()).not.toBe("");
    }
  });

  it("adds crawl and integrations to the primary navigation", () => {
    const paths = NAV_ITEMS.map((item) => item.to);
    expect(paths).toContain(ROUTES.crawl);
    expect(paths).toContain(ROUTES.integrations);
  });

  it("adds logs and tasks to the primary navigation", () => {
    const paths = NAV_ITEMS.map((item) => item.to);
    expect(paths).toContain(ROUTES.logs);
    expect(paths).toContain(ROUTES.tasks);
    expect(en["nav.logs"].trim()).not.toBe("");
    expect(en["nav.tasks"].trim()).not.toBe("");
  });

  it("adds the read-only diagnostics screen to the primary navigation", () => {
    expect(ROUTES.diagnostics).toBe("/diagnostics");
    const item = NAV_ITEMS.find((entry) => entry.to === ROUTES.diagnostics);
    expect(item?.key).toBe("nav.diagnostics");
    expect(en["nav.diagnostics"].trim()).not.toBe("");
  });

  it("keeps onboarding out of the primary navigation", () => {
    expect(NAV_ITEMS.some((item) => item.to === ROUTES.onboarding)).toBe(false);
  });

  it("keeps one nav entry per route", () => {
    const paths = NAV_ITEMS.map((item) => item.to);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
