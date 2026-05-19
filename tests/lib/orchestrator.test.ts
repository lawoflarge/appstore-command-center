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

const okDeps = (over: any = {}) => ({
  discoverApps: async () => [{ appId: "1", name: "A", bundleId: "b", sku: "s", firstSeen: "2026-05-18", hidden: false, archived: false, releases: [] }],
  collectSales: async () => ({ "1": { day: "2026-05-18", byCountry: { DE: 5 }, total: 5, redownloads: 0, proceedsUsd: 0 } }),
  collectAnalytics: async () => ({}),
  collectReviews: async () => [],
  collectRatings: async () => ({ day: "2026-05-18", byCountry: {}, avg: 0, count: 0 }),
  collectKeywords: async () => [],
  runIntelligence: async () => ({ generatedAt: "2026-05-18", apps: {} }),
  ...over,
});

test("runDailyCollection writes per-app data + insights + run-status, isolating failures", async () => {
  const store = memStore();
  const status = await runDailyCollection({
    day: "2026-05-18",
    store: store as any,
    deps: okDeps({ collectAnalytics: async () => { throw new Error("analytics down"); } }),
  });
  expect(store.fs.get("data/1/sales/2026-05.json")[0].total).toBe(5);
  expect(store.fs.get("data/insights.json").generatedAt).toBe("2026-05-18");
  expect(status.perApp["1"].analytics.ok).toBe(false);
  expect(status.perApp["1"].sales.ok).toBe(true);
});

test("a fully clean run stamps lastSuccess", async () => {
  const store = memStore();
  const status = await runDailyCollection({ day: "2026-05-18", store: store as any, deps: okDeps() });
  expect(status.lastSuccess).not.toBe("");
  expect(Number.isNaN(Date.parse(status.lastSuccess))).toBe(false);
});

test("any collector failure leaves lastSuccess empty (silent-failure watch)", async () => {
  const store = memStore();
  const status = await runDailyCollection({
    day: "2026-05-18", store: store as any,
    deps: okDeps({ collectAnalytics: async () => { throw new Error("x"); } }),
  });
  expect(status.lastSuccess).toBe("");
});

test("one app's analytics failure does not affect another app", async () => {
  const store = memStore();
  const status = await runDailyCollection({
    day: "2026-05-18", store: store as any,
    deps: okDeps({
      discoverApps: async () => [
        { appId: "1", name: "A", bundleId: "b", sku: "s", firstSeen: "2026-05-18", hidden: false, archived: false, releases: [] },
        { appId: "2", name: "B", bundleId: "b2", sku: "s2", firstSeen: "2026-05-18", hidden: false, archived: false, releases: [] },
      ],
      collectSales: async () => ({
        "1": { day: "2026-05-18", byCountry: {}, total: 1, redownloads: 0, proceedsUsd: 0 },
        "2": { day: "2026-05-18", byCountry: {}, total: 2, redownloads: 0, proceedsUsd: 0 },
      }),
      collectAnalytics: async (id: string) => { if (id === "1") throw new Error("a1 down"); return {}; },
    }),
  });
  expect(store.fs.get("data/2/sales/2026-05.json")[0].total).toBe(2);
  expect(status.perApp["1"].analytics.ok).toBe(false);
  expect(status.perApp["2"].analytics.ok).toBe(true);
  expect(status.perApp["2"].sales.ok).toBe(true);
});

test("runIntelligence failure is isolated, recorded, and blocks lastSuccess", async () => {
  const store = memStore();
  const status = await runDailyCollection({
    day: "2026-05-18", store: store as any,
    deps: okDeps({ runIntelligence: async () => { throw new Error("intel boom"); } }),
  });
  expect(status.perApp["1"].intelligence.ok).toBe(false);
  expect(status.lastSuccess).toBe("");
  expect(store.fs.has("data/insights.json")).toBe(false);
});
