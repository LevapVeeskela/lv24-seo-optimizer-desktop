import { describe, expect, it } from "vitest";
import {
  deriveProjectPaths,
  joinPath,
  samePath,
  siteLabel,
  workspaceLabel,
} from "./paths";

describe("workspace paths", () => {
  it("joins Windows and POSIX directories without duplicating separators", () => {
    expect(joinPath("C:\\work\\alpha", "seo.toml")).toBe(
      "C:\\work\\alpha\\seo.toml",
    );
    expect(joinPath("C:\\work\\alpha\\", "seo.toml")).toBe(
      "C:\\work\\alpha\\seo.toml",
    );
    expect(joinPath("/home/me/project", "seo.toml")).toBe(
      "/home/me/project/seo.toml",
    );
    expect(joinPath("/", "seo.toml")).toBe("/seo.toml");
    expect(joinPath("C:\\", "seo.toml")).toBe("C:\\seo.toml");
  });

  it("derives the config and data paths inside the chosen folder", () => {
    expect(deriveProjectPaths("C:\\work\\alpha")).toEqual({
      configPath: "C:\\work\\alpha\\seo.toml",
      dataDir: "C:\\work\\alpha\\data",
    });
    expect(deriveProjectPaths("/srv/site")).toEqual({
      configPath: "/srv/site/seo.toml",
      dataDir: "/srv/site/data",
    });
  });

  it("labels a workspace by the folder that owns seo.toml", () => {
    expect(workspaceLabel("C:\\work\\alpha\\seo.toml")).toBe("alpha");
    expect(workspaceLabel("/srv/site/seo.toml")).toBe("site");
    expect(workspaceLabel("seo.toml")).toBe("seo.toml");
    expect(workspaceLabel(null)).toBe("");
  });

  it("reduces a site URL or sc-domain property to a display host", () => {
    expect(siteLabel("https://example.com/path")).toBe("example.com");
    expect(siteLabel("http://localhost:3000")).toBe("localhost");
    expect(siteLabel("sc-domain:example.com")).toBe("example.com");
    expect(siteLabel("example.com")).toBe("example.com");
    expect(siteLabel("  ")).toBeNull();
  });

  it("compares Windows paths case-insensitively and POSIX paths exactly", () => {
    expect(samePath("C:\\Work\\Alpha\\seo.toml", "c:/work/alpha/seo.toml")).toBe(true);
    expect(samePath("C:\\work\\alpha\\", "C:\\work\\alpha")).toBe(true);
    expect(samePath("/srv/Site/seo.toml", "/srv/site/seo.toml")).toBe(false);
    expect(samePath(null, "/srv/site/seo.toml")).toBe(false);
    expect(samePath("", "")).toBe(false);
  });
});
