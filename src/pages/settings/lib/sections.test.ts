import { describe, expect, it, vi } from "vitest";
import type { ConfigDiffEntry } from "@/entities/config/model/types";
import {
  SETTINGS_SECTIONS,
  changedPaths,
  isFieldVisible,
  jumpToSection,
  sectionChangedPaths,
  sectionHasChanges,
} from "./sections";

function diff(...paths: string[]): ConfigDiffEntry[] {
  return paths.map((path) => ({
    path,
    saved: "a",
    draft: "b",
    reserved: false,
    kind: path.endsWith(".present") ? "presence" : "value",
  }));
}

function section(id: string) {
  const found = SETTINGS_SECTIONS.find((item) => item.id === id);
  if (!found) {
    throw new Error(`missing section ${id}`);
  }
  return found;
}

describe("settings sections", () => {
  it("maps every changed field to exactly one section", () => {
    const changed = changedPaths(
      diff(
        "project.name",
        "storage.data_dir",
        "providers.gsc.present",
        "report.locale",
        "report.thresholds.clicks_pct",
        "report.email.to",
        "report.telegram.chat_id",
        "crawl.max_urls",
      ),
    );

    for (const item of SETTINGS_SECTIONS) {
      expect(sectionHasChanges(item, changed)).toBe(true);
    }
    expect(sectionChangedPaths(section("settings-section-report"), changed)).toEqual(
      ["report.locale", "report.thresholds.clicks_pct"],
    );
    expect(sectionChangedPaths(section("settings-section-email"), changed)).toEqual(
      ["report.email.to"],
    );
  });

  it("keeps email and telegram out of the report section", () => {
    const changed = changedPaths(diff("report.email.enabled"));
    expect(sectionHasChanges(section("settings-section-report"), changed)).toBe(false);
    expect(sectionHasChanges(section("settings-section-email"), changed)).toBe(true);
  });

  it("treats an unknown path as belonging to no section", () => {
    const changed = changedPaths(diff("future.field"));
    for (const item of SETTINGS_SECTIONS) {
      expect(sectionHasChanges(item, changed)).toBe(false);
    }
  });

  it("filters fields only in changed-only mode", () => {
    const changed = changedPaths(diff("project.name"));
    expect(isFieldVisible(true, "project.name", changed)).toBe(true);
    expect(isFieldVisible(true, "project.base_url", changed)).toBe(false);
    expect(isFieldVisible(false, "project.base_url", changed)).toBe(true);
  });
});

describe("jumpToSection", () => {
  it("scrolls and focuses the target section", () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const doc = {
      getElementById: (id: string) =>
        id === "settings-section-crawl" ? { scrollIntoView, focus } : null,
    };

    expect(jumpToSection("settings-section-crawl", doc)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("reports a filtered-out section instead of throwing", () => {
    expect(jumpToSection("settings-section-email", { getElementById: () => null })).toBe(
      false,
    );
    expect(jumpToSection("settings-section-email", null)).toBe(false);
  });
});
