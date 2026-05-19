import { test, expect, vi } from "vitest";
import { runDailyCollection } from "@/lib/orchestrator";

function memStore() {
  const fs = new Map<string, any>();
  return {
    fs,
    readJson: vi.fn(async (p: string, fb: any) => (fs.has(p) ? fs.get(p) : fb)),
    writeJson: vi.fn(async (p: string, v: any) => { fs.set(p, v); }),
    upsertDailyArray: vi.fn(async (p: string, rows: any[]) => {
      const cur = fs.get(p) ?? [];
      const m = new Map(cur.map((r: any) => [r.day, r]));
      for (const r of rows) m.set(r.day, r);
      fs.set(p, [...m.values()]);
    }),
  };
}

test("runDailyCollection writes per-app data + insights + run-status, isolating failures", async () => {
  const store = memStore();
  const status = await runDailyCollection({
    day: "2026-05-18",
    store: store as any,
    deps: {
      discoverApps: async () => [{ appId: "1", name: "A", bundleId: "b", sku: "s", firstSeen: "2026-05-18", hidden: false, archived: false, releases: [] }],
      collectSales: async () => ({ "1": { day: "2026-05-18", byCountry: { DE: 5 }, total: 5, redownloads: 0, proceedsUsd: 0 } }),
      collectAnalytics: async () => { throw new Error("analytics down"); },
      collectReviews: async () => [],
      collectRatings: async () => ({ day: "2026-05-18", byCountry: {}, avg: 0, count: 0 }),
      collectKeywords: async () => [],
      runIntelligence: async () => ({ generatedAt: "2026-05-18", apps: {} }),
    },
  });
  expect(store.fs.get("data/1/sales/2026-05.json")[0].total).toBe(5);
  expect(store.fs.get("data/insights.json").generatedAt).toBe("2026-05-18");
  expect(status.perApp["1"].analytics.ok).toBe(false);
  expect(status.perApp["1"].sales.ok).toBe(true);
});
