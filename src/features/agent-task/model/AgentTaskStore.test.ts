import { describe, expect, it } from "vitest";
import type { Recommendation } from "@/entities/recommendation/model/types";
import type { AgentTaskStorage } from "../lib/queue";
import { AgentTaskStore } from "./AgentTaskStore";

const NOW = new Date("2026-11-14T12:00:00.000Z");
const PERIOD = { start: "2026-11-01", end: "2026-11-07" };

const recommendation: Recommendation = {
  id: "data_quality:stats:gsc-missing-token-1234",
  category: "configuration",
  severity: "high",
  source: "stats",
  provider: "gsc",
  title: "Connect Google Search Console: token missing",
  action: "Store the token outside the repository.",
  verification: "lv24-seo auth status --json should show the provider.",
  evidence: [{ key: "status", value: "missing_token" }],
};

function memoryStorage(): AgentTaskStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("AgentTaskStore", () => {
  it("persists draft, copied and exported states across instances", () => {
    const storage = memoryStorage();
    const store = new AgentTaskStore(storage, () => NOW);

    expect(store.size).toBe(0);
    store.add(recommendation, "sc-domain:example.com", PERIOD);
    expect(store.size).toBe(1);
    expect(store.has(recommendation.id)).toBe(true);
    expect(store.tasks[0]?.status).toBe("draft");
    expect(store.tasks[0]?.property).toBe("sc-domain:example.com");

    store.markCopied(recommendation.id);
    expect(store.tasks[0]?.status).toBe("copied");

    const reloaded = new AgentTaskStore(storage, () => NOW);
    expect(reloaded.size).toBe(1);
    expect(reloaded.tasks[0]?.status).toBe("copied");

    reloaded.markExported(recommendation.id);
    expect(reloaded.tasks[0]?.status).toBe("exported");

    reloaded.remove(recommendation.id);
    expect(reloaded.size).toBe(0);
    expect(new AgentTaskStore(storage, () => NOW).size).toBe(0);
  });

  it("does not duplicate a task that is already queued", () => {
    const store = new AgentTaskStore(memoryStorage(), () => NOW);
    store.add(recommendation, null, null);
    store.add(recommendation, null, null);
    expect(store.size).toBe(1);

    store.clear();
    expect(store.size).toBe(0);
  });
});
