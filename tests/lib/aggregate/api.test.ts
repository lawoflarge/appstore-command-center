import { test, expect } from "vitest";
import { buildGlance } from "@/lib/aggregate/api";

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
