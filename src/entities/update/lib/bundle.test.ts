import { describe, expect, it } from "vitest";
import {
  bundleSupportsAutoUpdate,
  isPortableEngineSource,
  normalizeBundleKind,
} from "./bundle";

describe("portable engine sources", () => {
  it.each(["sibling", "bundled-flat", "BUNDLED-FLAT", " sibling "])(
    "treats %s as portable",
    (source) => {
      expect(isPortableEngineSource(source)).toBe(true);
    },
  );

  it.each(["bundled", "env", "", null, undefined])(
    "does not treat %s as portable",
    (source) => {
      expect(isPortableEngineSource(source)).toBe(false);
    },
  );
});

describe("bundle kinds", () => {
  it.each(["deb", "rpm", "msi", " MSI ", "unknown", " DEB "])(
    "disables in-app updates for %s",
    (kind) => {
      expect(bundleSupportsAutoUpdate(kind)).toBe(false);
    },
  );

  it.each(["appimage", "nsis", "app"])(
    "keeps in-app updates for %s",
    (kind) => {
      expect(bundleSupportsAutoUpdate(kind)).toBe(true);
    },
  );

  it("keeps the updater usable until the shell reports a bundle type", () => {
    expect(bundleSupportsAutoUpdate(null)).toBe(true);
    expect(bundleSupportsAutoUpdate(undefined)).toBe(true);
  });

  it("normalizes missing bundle kinds to unknown", () => {
    expect(normalizeBundleKind(null)).toBe("unknown");
    expect(normalizeBundleKind(" NSIS ")).toBe("nsis");
  });
});
