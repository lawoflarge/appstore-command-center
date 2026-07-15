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

test("analytics rolling-window rows are filed by their OWN month, not all into today's month file", async () => {
  // Apple's analytics report is a rolling multi-day window; on 06-02 it still includes late-May days.
  // Each row must land in its own month file (like sales) so a day never duplicates across months.
  const store = memStore();
  const a = (day: string, downloads: number) => ({ day, impressions: 0, pageViews: 0, downloads, sessions: 0, activeDevices: 0, deletions: 0, crashes: 0, bySource: {} });
  await runDailyCollection({
    day: "2026-06-02", store: store as any,
    deps: okDeps({
      collectAnalytics: async () => ({
        "2026-05-31": a("2026-05-31", 7),
        "2026-06-01": a("2026-06-01", 3),
        "2026-06-02": a("2026-06-02", 1),
      }),
    }),
  });
  expect(store.fs.has("data/1/analytics/2026-05.json")).toBe(true);
  expect(store.fs.get("data/1/analytics/2026-05.json").map((r: any) => r.day)).toEqual(["2026-05-31"]);
  expect(store.fs.get("data/1/analytics/2026-06.json").map((r: any) => r.day)).toEqual(["2026-06-01", "2026-06-02"]);
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

// A transient GitHub Contents API error (5xx / 403 rate-limit / exhausted-409) makes
// the store WRITE throw, not just the collector. Those writes must be isolated too —
// otherwise one app's failed write rejects Promise.all and 500s the entire cron run.
// This reproduces the production "HTTP 500 (empty body)" failures.
test("a store write failure is isolated and does not crash the whole run", async () => {
  const store = memStore();
  const realUpsert = store.upsertDailyArray;
  store.upsertDailyArray = vi.fn(async (p: string, rows: any[], msg?: string) => {
    if (p.includes("/analytics/")) throw new Error("GH PUT 500 analytics");
    return realUpsert(p, rows, msg);
  });
  const aDay = { day: "2026-05-18", impressions: 10, pageViews: 5, downloads: 2, sessions: 0, activeDevices: 0, deletions: 0, crashes: 0, bySource: {} };
  const status = await runDailyCollection({
    day: "2026-05-18", store: store as any,
    deps: okDeps({ collectAnalytics: async () => ({ "2026-05-18": aDay }) }),
  });
  // The run completed instead of throwing; the failed write is recorded; unrelated
  // per-app data still persisted; a write failure keeps lastSuccess empty.
  expect(status.perApp["1"].analytics.ok).toBe(false);
  expect(store.fs.get("data/1/sales/2026-05.json")[0].total).toBe(5);
  expect(status.lastSuccess).toBe("");
});

// The cron round-robin + the refresh's per-app phases collect only a SUBSET of apps per
// invocation (so a single run stays under Vercel's 60s cap). `appIds` restricts the per-app
// work to that batch; `intelligence: false` defers the cross-app insights pass.
test("appIds restricts per-app collection to the batch; intelligence:false skips insights", async () => {
  const store = memStore();
  const status = await runDailyCollection({
    day: "2026-05-18", store: store as any,
    appIds: ["2"], intelligence: false,
    deps: okDeps({
      discoverApps: async () => [
        { appId: "1", name: "A", bundleId: "b", sku: "s", firstSeen: "2026-05-18", hidden: false, archived: false, releases: [] },
        { appId: "2", name: "B", bundleId: "b2", sku: "s2", firstSeen: "2026-05-18", hidden: false, archived: false, releases: [] },
      ],
      collectSales: async () => ({
        "1": { day: "2026-05-18", byCountry: {}, total: 1, redownloads: 0, proceedsUsd: 0 },
        "2": { day: "2026-05-18", byCountry: {}, total: 2, redownloads: 0, proceedsUsd: 0 },
      }),
    }),
  });
  expect(store.fs.get("data/2/sales/2026-05.json")[0].total).toBe(2);
  expect(store.fs.has("data/1/sales/2026-05.json")).toBe(false); // app 1 not in this batch
  expect(store.fs.has("data/insights.json")).toBe(false);        // intelligence deferred
  expect(status.perApp["2"].sales.ok).toBe(true);
  expect(status.perApp["1"]).toBeUndefined();
});

// A batch run persists its marks; a later finish pass (appIds: []) runs intelligence over ALL
// apps from the store and MERGES status — it must not blank the earlier batch's marks.
test("finish pass writes insights from store + merges status without re-collecting per-app", async () => {
  const store = memStore();
  await runDailyCollection({ day: "2026-05-18", store: store as any, appIds: ["1"], intelligence: false, deps: okDeps() });
  expect(store.fs.has("data/insights.json")).toBe(false);

  const status = await runDailyCollection({ day: "2026-05-18", store: store as any, appIds: [], intelligence: true, deps: okDeps() });
  expect(store.fs.get("data/insights.json").generatedAt).toBe("2026-05-18");
  expect(status.perApp["1"]?.sales?.ok).toBe(true); // earlier batch's mark survived the merge
});

// 2026-07-15 outage: a GitHub 502 "Unicorn" HTML error page (~55 kB, inline base64 image)
// was recorded VERBATIM as intelligence.error for all 22 apps → run-status.json grew past
// GitHub's 1 MB Contents-API limit → every read returned empty content → every page 500'd
// and run-status froze. Errors recorded into run-status must be bounded.
test("recorded errors are truncated so run-status can never balloon past the 1MB read limit", async () => {
  const store = memStore();
  const huge = "GH GET 502 data/x.json: " + "<html>".repeat(10_000); // ~60 kB, like the real 502 page
  const status = await runDailyCollection({
    day: "2026-05-18", store: store as any,
    deps: okDeps({ runIntelligence: async () => { throw new Error(huge); } }),
  });
  const err = status.perApp["1"].intelligence.error!;
  expect(err.length).toBeLessThan(700);
  expect(err).toContain("GH GET 502");
});

// Intelligence success previously recorded NO mark, so a stale failed mark (with its giant
// error string) survived every later successful run via the status merge — forever.
test("a successful intelligence pass marks intelligence ok and clears a stale failure", async () => {
  const store = memStore();
  store.fs.set("data/run-status.json", {
    lastRun: "2026-05-17T00:00:00Z", lastSuccess: "",
    perApp: { "1": { intelligence: { ok: false, at: "2026-05-17T00:00:00Z", error: "old giant error" } } },
  });
  const status = await runDailyCollection({ day: "2026-05-18", store: store as any, deps: okDeps() });
  expect(status.perApp["1"].intelligence.ok).toBe(true);
  expect(status.perApp["1"].intelligence.error).toBeUndefined();
  const persisted = store.fs.get("data/run-status.json");
  expect(persisted.perApp["1"].intelligence.ok).toBe(true);
});

// Meta had the same stale-failure bug as intelligence: success recorded no mark, so a
// transient 409 failure mark from weeks ago survived every later merge and kept
// lastSuccess permanently empty.
test("a successful meta write marks meta ok and clears a stale failure", async () => {
  const store = memStore();
  store.fs.set("data/run-status.json", {
    lastRun: "2026-05-17T00:00:00Z", lastSuccess: "",
    perApp: { "1": { meta: { ok: false, at: "2026-05-17T00:00:00Z", error: "GH PUT 409 stale" } } },
  });
  const status = await runDailyCollection({ day: "2026-05-18", store: store as any, deps: okDeps() });
  expect(status.perApp["1"].meta.ok).toBe(true);
  const persisted = store.fs.get("data/run-status.json");
  expect(persisted.perApp["1"].meta.ok).toBe(true);
  expect(persisted.lastSuccess).not.toBe("");
});
