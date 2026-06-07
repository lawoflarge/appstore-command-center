import { test, expect } from "vitest";
import { buildGlance, visibleAppIds } from "@/lib/aggregate/api";

test("buildGlance assembles totals + rating + insights per visible app", async () => {
  const store = {
    readJson: async (p: string, fb: any) => {
      if (p === "data/config.json") return { apps: {} };
      if (p === "data/1/meta.json") return { appId: "1", name: "A", hidden: false, archived: false, releases: [] };
      if (p === "data/1/sales/2026-05.json") return [{ day: "2026-05-18", byCountry: {}, total: 8, redownloads: 0, proceedsUsd: 0 }];
      if (p === "data/1/ratings/2026-05.json") return [{ day: "2026-05-18", byCountry: {}, avg: 4.5, count: 100 }];
      if (p === "data/insights.json") return { generatedAt: "2026-05-18", apps: { "1": { name: "A", anomaly: null } } };
      return fb;
    },
  };
  const g = await buildGlance(store as any, ["1"], "2026-05");
  expect(g.apps[0]).toMatchObject({ appId: "1", name: "A", today: 8, rating: { avg: 4.5, count: 100 } });
  expect(g.blendedRating).toEqual({ avg: 4.5, count: 100 });
});

test("buildGlance reports each app's value AT the shared latest day, N/A (null) when that app has no row for it", async () => {
  // "Fresh" has analytics through 2026-06-06; "Lagging" only through 2026-06-05.
  // The shared latest day is 2026-06-06. Lagging must NOT contribute its stale 06-05 value
  // under the 06-06 label — that is the reported Glance/chart contradiction.
  const a = (day: string, downloads: number) => ({
    day, impressions: 0, pageViews: 0, downloads, sessions: 0,
    activeDevices: 0, deletions: 0, crashes: 0, bySource: {},
  });
  const store = {
    readJson: async (p: string, fb: any) => {
      if (p === "data/config.json") return { apps: {} };
      if (p === "data/1/meta.json") return { appId: "1", name: "Fresh", hidden: false, archived: false, releases: [] };
      if (p === "data/2/meta.json") return { appId: "2", name: "Lagging", hidden: false, archived: false, releases: [] };
      if (p === "data/1/analytics/2026-06.json") return [a("2026-06-05", 3), a("2026-06-06", 2)];
      if (p === "data/2/analytics/2026-06.json") return [a("2026-06-04", 1), a("2026-06-05", 4)];
      if (p === "data/insights.json") return { apps: {} };
      return fb;
    },
  };
  const g = await buildGlance(store as any, ["1", "2"], "2026-06");
  expect(g.latestDay).toBe("2026-06-06");
  const fresh = g.apps.find((x: any) => x.appId === "1")!;
  const lagging = g.apps.find((x: any) => x.appId === "2")!;
  expect(fresh.today).toBe(2);        // value at the shared latest day
  expect(lagging.today).toBeNull();   // no 2026-06-06 row → N/A, not the stale 4
});

test("visibleAppIds returns all discovered apps when config is empty (day-0 default)", async () => {
  const store = {
    readJson: async (p: string, fb: any) => {
      if (p === "data/config.json") return { apps: {} };
      if (p === "data/run-status.json") return {
        lastRun: "x", lastSuccess: "x",
        perApp: { "111": { sales: { ok: true, at: "x" } }, "222": { sales: { ok: true, at: "x" } } },
      };
      return fb;
    },
  };
  const ids = await visibleAppIds(store as any);
  expect(ids.sort()).toEqual(["111", "222"]);
});

test("visibleAppIds filters out hidden/archived apps when config has them", async () => {
  const store = {
    readJson: async (p: string, fb: any) => {
      if (p === "data/config.json") return {
        apps: {
          "111": { hidden: true, archived: false, keywords: [] },
          "222": { hidden: false, archived: true, keywords: [] },
          "333": { hidden: false, archived: false, keywords: [] },
        },
      };
      if (p === "data/run-status.json") return {
        lastRun: "x", lastSuccess: "x",
        perApp: { "111": {}, "222": {}, "333": {}, "444": {} },
      };
      return fb;
    },
  };
  const ids = await visibleAppIds(store as any);
  // 111 hidden, 222 archived → filtered. 333 explicit-visible, 444 not-in-config → default-visible.
  expect(ids.sort()).toEqual(["333", "444"]);
});

test("visibleAppIds returns [] before any cron run (no run-status yet)", async () => {
  const store = { readJson: async (_p: string, fb: any) => fb };
  expect(await visibleAppIds(store as any)).toEqual([]);
});
