import { test, expect } from "vitest";
import { loadRawBundle } from "@/lib/aggregate/rawBundle";

// Every chart, funnel and breakdown on Glance and the per-app page reads through loadRawBundle,
// so the countFrom cutoff (app transfer) is applied here once for all of them.
test("loadRawBundle drops every pre-countFrom row of a transferred app and keeps other apps whole", async () => {
  const a = (day: string, downloads: number) => ({
    day, impressions: 10, pageViews: 5, downloads, sessions: 0,
    activeDevices: 0, deletions: 0, crashes: 0, bySource: { search: downloads },
  });
  const s = (day: string, proceedsEur: number) => ({ day, byCountry: { US: 1 }, total: 1, redownloads: 0, proceedsUsd: proceedsEur, proceedsEur });
  const files: Record<string, unknown> = {
    "data/config.json": { apps: { "1": { hidden: false, archived: false, keywords: [], countFrom: "2026-11-01" } } },
    "data/1/meta.json": { name: "Transferred" },
    "data/2/meta.json": { name: "Own" },
    "data/1/analytics/2026-10.json": [a("2026-10-31", 50)],
    "data/1/analytics/2026-11.json": [a("2026-11-01", 2)],
    "data/1/sales/2026-10.json": [s("2026-10-31", 9.99)],
    "data/1/sales/2026-11.json": [s("2026-11-01", 4.99)],
    "data/1/ratings/2026-10.json": [{ day: "2026-10-31", byCountry: {}, avg: 4.8, count: 900 }],
    "data/1/keywords/2026-10.json": [{ day: "2026-10-31", term: "x", country: "us", rank: 1 }],
    "data/1/reviews.json": [
      { id: "old", rating: 5, title: "", body: "", reviewer: "", territory: "USA", createdDate: "2026-10-20T10:00:00-07:00", responded: false },
      { id: "new", rating: 4, title: "", body: "", reviewer: "", territory: "USA", createdDate: "2026-11-01T10:00:00-07:00", responded: false },
    ],
    "data/2/analytics/2026-10.json": [a("2026-10-31", 7)],
    "data/2/sales/2026-10.json": [s("2026-10-31", 1.5)],
    "data/2/reviews.json": [{ id: "own", rating: 5, title: "", body: "", reviewer: "", territory: "USA", createdDate: "2026-10-20T10:00:00-07:00", responded: false }],
  };
  const store = { readJson: async (p: string, fb: unknown) => (p in files ? files[p] : fb) };
  const raw = await loadRawBundle(store as any, ["1", "2"], "2026-11-02", 4);
  expect(raw.analytics["1"].map((r) => r.day)).toEqual(["2026-11-01"]);
  expect(raw.sales["1"].map((r) => r.day)).toEqual(["2026-11-01"]);
  expect(raw.ratings["1"]).toEqual([]);
  expect(raw.keywords["1"]).toEqual([]);
  expect(raw.reviews["1"].map((r) => r.id)).toEqual(["new"]);
  expect(raw.analytics["2"].map((r) => r.day)).toEqual(["2026-10-31"]);
  expect(raw.sales["2"].map((r) => r.day)).toEqual(["2026-10-31"]);
  expect(raw.reviews["2"].map((r) => r.id)).toEqual(["own"]);
});
