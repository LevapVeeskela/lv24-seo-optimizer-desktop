import { describe, expect, it } from "vitest";
import type { Recommendation } from "@/entities/recommendation/model/types";
import {
  joinExportPath,
  pendingQueueIds,
  planBulkExport,
} from "./bulk";

function recommendation(id: string): Recommendation {
  return {
    id,
    category: "crawl",
    severity: "high",
    source: "crawl",
    title: `Broken link on /${id}`,
    action: "Fix the link",
    verification: "Recrawl the page",
    evidence: [],
  };
}

describe("joinExportPath", () => {
  it("uses the export root's separator and trims trailing slashes", () => {
    expect(joinExportPath("C:\\exports\\", "task.md")).toBe(
      "C:\\exports\\task.md",
    );
    expect(joinExportPath("/home/user/exports/", "task.md")).toBe(
      "/home/user/exports/task.md",
    );
  });
});

describe("pendingQueueIds", () => {
  it("skips items that are already queued", () => {
    const items = [recommendation("a"), recommendation("b"), recommendation("c")];
    const queued = new Set(["b"]);
    expect(pendingQueueIds(items, (id) => queued.has(id))).toEqual(["a", "c"]);
  });

  it("returns nothing when every visible item is queued", () => {
    expect(pendingQueueIds([recommendation("a")], () => true)).toEqual([]);
  });
});

describe("planBulkExport", () => {
  it("writes one deterministic Markdown file per visible task", () => {
    const files = planBulkExport(
      [recommendation("a"), recommendation("b")],
      "sc-domain:example.com",
      { start: "2026-11-01", end: "2026-11-07" },
      "/exports",
    );

    expect(files.map((file) => file.path)).toEqual([
      "/exports/a.md",
      "/exports/b.md",
    ]);
    expect(new Set(files.map((file) => file.path)).size).toBe(2);
    expect(files[0].content).toContain("Broken link on /a");
    expect(files[0].content).toContain("sc-domain:example.com");
    expect(files[0].content).toContain("2026-11-01");
  });
});
