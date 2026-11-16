import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@/shared/desktop/files", () => ({ writeTextFile: vi.fn() }));

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@/shared/desktop/files";
import type { Recommendation } from "@/entities/recommendation/model/types";
import {
  ensureMarkdownPath,
  exportRecommendationPrompt,
  isWithinDirectory,
} from "./actions";

const saveMock = vi.mocked(save);
const writeMock = vi.mocked(writeTextFile);

const recommendation: Recommendation = {
  id: "gsc-opportunity-1",
  category: "opportunity",
  severity: "high",
  source: "gsc",
  title: "Improve CTR on the pricing page",
  action: "Rewrite the title and meta description.",
  verification: "Check GSC CTR after 14 days.",
  evidence: [{ key: "ctr", value: "1.2%" }],
};

describe("exportRecommendationPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes through the native dialog and the shell export command", async () => {
    saveMock.mockResolvedValue("C:\\exports\\gsc-opportunity-1.md");
    writeMock.mockResolvedValue({
      path: "C:\\exports\\gsc-opportunity-1.md",
      bytes: 10,
    });

    await expect(
      exportRecommendationPrompt(recommendation, "https://example.com", null, {
        defaultDir: "C:\\exports",
      }),
    ).resolves.toEqual({ status: "exported" });

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "C:\\exports\\gsc-opportunity-1.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      }),
    );
    expect(writeMock).toHaveBeenCalledWith(
      "C:\\exports\\gsc-opportunity-1.md",
      expect.stringContaining("Improve CTR"),
    );
  });

  it("joins a POSIX export directory with a forward slash", async () => {
    saveMock.mockResolvedValue("/home/user/exports/gsc-opportunity-1.md");
    writeMock.mockResolvedValue({
      path: "/home/user/exports/gsc-opportunity-1.md",
      bytes: 10,
    });

    await exportRecommendationPrompt(recommendation, null, null, {
      defaultDir: "/home/user/exports/",
    });

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "/home/user/exports/gsc-opportunity-1.md",
      }),
    );
  });

  it("treats a closed dialog as canceled, not as a failure", async () => {
    saveMock.mockResolvedValue(null);

    await expect(exportRecommendationPrompt(recommendation, null, null)).resolves.toEqual(
      { status: "canceled" },
    );
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("rejects a save outside the export root before writing", async () => {
    saveMock.mockResolvedValue("C:\\Users\\Public\\gsc-opportunity-1.md");

    const result = await exportRecommendationPrompt(recommendation, null, null, {
      defaultDir: "C:\\Users\\me\\AppData\\Roaming\\by.lv24.seo.desktop\\exports",
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("PATH_NOT_ALLOWED");
    expect(result.error?.message).toContain("Exports must be saved under");
    // The shell is never asked to write a path it would refuse.
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("accepts a nested folder under the export root", async () => {
    saveMock.mockResolvedValue("/home/user/exports/2026-11/gsc-opportunity-1.md");
    writeMock.mockResolvedValue({
      path: "/home/user/exports/2026-11/gsc-opportunity-1.md",
      bytes: 10,
    });

    await expect(
      exportRecommendationPrompt(recommendation, null, null, {
        defaultDir: "/home/user/exports",
      }),
    ).resolves.toEqual({ status: "exported" });
    expect(writeMock).toHaveBeenCalledTimes(1);
  });

  it("compares export roots case-insensitively and without a trailing slash", () => {
    expect(isWithinDirectory("C:\\Exports\\task.md", "c:\\exports\\")).toBe(true);
    expect(isWithinDirectory("/home/user/exports/task.md", "/home/user/exports")).toBe(
      true,
    );
    expect(isWithinDirectory("/home/user/exports-evil/task.md", "/home/user/exports")).toBe(
      false,
    );
    expect(isWithinDirectory("/home/user/Exports/task.md", "/home/user/exports")).toBe(
      true,
    );
    expect(isWithinDirectory("/home/user/exports/task.md", "")).toBe(false);
  });

  it("reports a rejected write with the shell's actionable error", async () => {
    saveMock.mockResolvedValue("C:\\Windows\\task.md");
    writeMock.mockRejectedValue({
      code: "PATH_NOT_ALLOWED",
      message: "export is outside the export root",
    });

    const result = await exportRecommendationPrompt(recommendation, null, null);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("PATH_NOT_ALLOWED");
    expect(result.error?.message).toContain("export root");
  });

  it("adds the Markdown extension when the native dialog returns a bare path", () => {
    expect(ensureMarkdownPath("C:\\exports\\task")).toBe("C:\\exports\\task.md");
    expect(ensureMarkdownPath("/home/user/task")).toBe("/home/user/task.md");
    expect(ensureMarkdownPath("C:\\exports\\task.md")).toBe("C:\\exports\\task.md");
    expect(ensureMarkdownPath("C:\\exports\\task.MD")).toBe("C:\\exports\\task.MD");
    expect(ensureMarkdownPath("")).toBe("");
  });
});
