import { describe, expect, it } from "vitest";
import type { Recommendation } from "@/entities/recommendation/model/types";
import {
  addAgentTask,
  agentTaskFilename,
  createAgentTask,
  loadAgentTaskQueue,
  parseAgentTaskQueue,
  removeAgentTask,
  saveAgentTaskQueue,
  serializeAgentTaskQueue,
  setAgentTaskStatus,
  type AgentTaskStorage,
} from "./queue";

const PERIOD = { start: "2026-11-01", end: "2026-11-07" };
const NOW = new Date("2026-11-14T12:00:00.000Z");

const recommendation: Recommendation = {
  id: "opportunity:gsc:seo-audit-1234",
  category: "opportunity",
  severity: "high",
  source: "gsc",
  provider: "gsc",
  title: 'Move "seo audit" from position 12.4 into the top results',
  action: "Strengthen the title and snippet.",
  verification: "Rebuild the weekly report and compare position.",
  evidence: [{ key: "position", value: "12.4" }],
  query: "seo audit",
  page: "https://example.com/seo-audit",
  expected_clicks: 36,
};

function memoryStorage(): AgentTaskStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("agent task queue helpers", () => {
  it("creates a draft task with a snapshot and normalised context", () => {
    const task = createAgentTask(
      recommendation,
      "  sc-domain:example.com  ",
      PERIOD,
      NOW,
    );

    expect(task).toEqual({
      id: recommendation.id,
      recommendation,
      property: "sc-domain:example.com",
      period: PERIOD,
      status: "draft",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });

    const emptyContext = createAgentTask(recommendation, null, null, NOW);
    expect(emptyContext.property).toBeNull();
    expect(emptyContext.period).toBeNull();
  });

  it("adds once, updates status and removes by id", () => {
    const task = createAgentTask(recommendation, "sc-domain:example.com", PERIOD, NOW);
    const first = addAgentTask([], task);
    expect(first).toEqual([task]);
    expect(addAgentTask(first, task)).toBe(first);

    const later = new Date("2026-11-14T13:00:00.000Z");
    const copied = setAgentTaskStatus(first, task.id, "copied", later);
    expect(copied).toHaveLength(1);
    expect(copied[0]?.status).toBe("copied");
    expect(copied[0]?.updatedAt).toBe(later.toISOString());
    expect(copied[0]?.createdAt).toBe(NOW.toISOString());

    const exported = setAgentTaskStatus(copied, task.id, "exported", later);
    expect(exported[0]?.status).toBe("exported");

    expect(setAgentTaskStatus(first, "missing", "copied", later)).toBe(first);
    expect(removeAgentTask(first, "missing")).toBe(first);
    expect(removeAgentTask(first, task.id)).toEqual([]);
  });

  it("parses storage tolerantly and round-trips valid tasks", () => {
    const task = createAgentTask(recommendation, "sc-domain:example.com", PERIOD, NOW);
    const raw = serializeAgentTaskQueue([task]);

    expect(parseAgentTaskQueue(null)).toEqual([]);
    expect(parseAgentTaskQueue("not json")).toEqual([]);
    expect(parseAgentTaskQueue("{}")).toEqual([]);
    expect(parseAgentTaskQueue(raw)).toEqual([task]);
    expect(parseAgentTaskQueue(JSON.stringify([task, task]))).toHaveLength(1);

    const invalidStatus = parseAgentTaskQueue(
      JSON.stringify([{ ...task, status: "done" }]),
    );
    expect(invalidStatus).toEqual([]);

    const invalidRecommendation = parseAgentTaskQueue(
      JSON.stringify([{ ...task, recommendation: {} }]),
    );
    expect(invalidRecommendation).toEqual([]);

    const mismatchedId = parseAgentTaskQueue(
      JSON.stringify([
        { ...task, id: "different-id" },
      ]),
    );
    expect(mismatchedId).toEqual([]);
  });

  it("loads and saves through a storage-like object", () => {
    const storage = memoryStorage();
    const task = createAgentTask(recommendation, "sc-domain:example.com", PERIOD, NOW);

    expect(loadAgentTaskQueue(storage)).toEqual([]);
    saveAgentTaskQueue(storage, [task]);
    expect(loadAgentTaskQueue(storage)).toEqual([task]);
    expect(loadAgentTaskQueue(null)).toEqual([]);
  });

  it("builds deterministic, filesystem-safe Markdown filenames", () => {
    expect(agentTaskFilename("opportunity:gsc:seo audit-1234")).toBe(
      "opportunity-gsc-seo-audit-1234.md",
    );
    expect(agentTaskFilename("///")).toBe("recommendation.md");
  });
});
