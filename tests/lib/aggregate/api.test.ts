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
