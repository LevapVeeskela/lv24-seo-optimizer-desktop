import { describe, expect, it } from "vitest";
import { configMissing, type ShellStatus } from "./types";

function status(overrides: Partial<ShellStatus>): ShellStatus {
  return { desktop: { version: "0.2.2" }, engine: { found: true }, ...overrides };
}

describe("configMissing", () => {
  it("is true only when the shell reported a path and configExists=false", () => {
    expect(configMissing(status({ configPath: "C:\\w\\seo.toml", configExists: false }))).toBe(true);
  });

  it("is false for an existing workspace", () => {
    expect(configMissing(status({ configPath: "C:\\w\\seo.toml", configExists: true }))).toBe(false);
  });

  it("treats an absent flag as unknown, not missing", () => {
    expect(configMissing(status({ configPath: "C:\\w\\seo.toml" }))).toBe(false);
    expect(configMissing(status({}))).toBe(false);
    expect(configMissing(null)).toBe(false);
  });

  it("does not report a moved workspace when no path is configured", () => {
    expect(configMissing(status({ configPath: null, configExists: false }))).toBe(false);
  });
});
