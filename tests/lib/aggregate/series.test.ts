// tests/lib/aggregate/series.test.ts
import { describe, it, expect } from "vitest";
import { buildSeries, type RawBundle } from "@/lib/aggregate/series";
import type { ChartCard } from "@/lib/dashboards/types";

const fakeBundle = (): RawBundle => ({
  apps: { "1": { name: "Alpha" }, "2": { name: "Beta" } },
  sales: {
    "1": [
      { day: "2026-05-20", byCountry: { US: 10 }, total: 10, redownloads: 1, proceedsUsd: 5 },
      { day: "2026-05-21", byCountry: { US: 12 }, total: 12, redownloads: 0, proceedsUsd: 6 },
      { day: "2026-05-22", byCountry: { US: 14 }, total: 14, redownloads: 2, proceedsUsd: 7 },
    ],
    "2": [
      { day: "2026-05-22", byCountry: { US: 4 }, total: 4, redownloads: 0, proceedsUsd: 2 },
    ],
  },
  analytics: { "1": [], "2": [] },
  ratings: { "1": [], "2": [] },
  reviews: { "1": [], "2": [] },
  keywords: { "1": [], "2": [] },
  today: "2026-05-22",
});

const baseCard: ChartCard = {
  id: "c1", title: "Downloads", metric: "downloads", viz: "area",
  appIds: ["1"], range: "7d", bucket: "day", breakdown: "none", compare: "none",
};

describe("buildSeries — area", () => {
  it("returns daily points within the range", () => {
    const r = buildSeries(baseCard, fakeBundle());
    expect(r.kind).toBe("area");
    if (r.kind !== "area") return;
    expect(r.points).toEqual([
      { day: "2026-05-20", value: 10 },
      { day: "2026-05-21", value: 12 },
      { day: "2026-05-22", value: 14 },
    ]);
  });

  it("sums across multiple apps when appIds=all", () => {
    const r = buildSeries({ ...baseCard, appIds: "all" }, fakeBundle());
    if (r.kind !== "area") throw new Error();
    const may22 = r.points.find((p) => p.day === "2026-05-22");
    expect(may22?.value).toBe(18); // 14 + 4
  });
});

describe("buildSeries — bar", () => {
  it("returns the same point shape as area", () => {
    const r = buildSeries({ ...baseCard, viz: "bar" }, fakeBundle());
    expect(r.kind).toBe("bar");
  });
});

describe("buildSeries — heatmap", () => {
  it("returns one point per day", () => {
    const r = buildSeries({ ...baseCard, viz: "heatmap", range: "30d" }, fakeBundle());
    expect(r.kind).toBe("heatmap");
  });
});

describe("buildSeries — range windowing", () => {
  it("7d range keeps last 7 days inclusive of today", () => {
    const bundle = fakeBundle();
    const r = buildSeries({ ...baseCard, range: "7d" }, bundle);
    if (r.kind !== "area") throw new Error();
    for (const p of r.points) {
      expect(p.day >= "2026-05-16").toBe(true);
      expect(p.day <= "2026-05-22").toBe(true);
    }
  });
});

describe("buildSeries — multiLine breakdown=app", () => {
  it("returns one series per app", () => {
    const card: ChartCard = { ...baseCard, viz: "multiLine", appIds: "all", breakdown: "app" };
    const r = buildSeries(card, fakeBundle());
    if (r.kind !== "multiLine") throw new Error();
    expect(r.series).toHaveLength(2);
    const alpha = r.series.find((s) => s.key === "1");
    expect(alpha?.label).toBe("Alpha");
    expect(alpha?.points.at(-1)?.value).toBe(14);
  });
});

describe("buildSeries — stackedArea breakdown=country", () => {
  it("returns one series per country across the window", () => {
    const card: ChartCard = { ...baseCard, viz: "stackedArea", appIds: "all", breakdown: "country" };
    const r = buildSeries(card, fakeBundle());
    if (r.kind !== "stackedArea") throw new Error();
    expect(r.series.some((s) => s.key === "US")).toBe(true);
  });
});

describe("buildSeries — smallMultiples", () => {
  it("returns one mini series per app regardless of breakdown", () => {
    const card: ChartCard = { ...baseCard, viz: "smallMultiples", appIds: "all", breakdown: "none" };
    const r = buildSeries(card, fakeBundle());
    if (r.kind !== "smallMultiples") throw new Error();
    expect(r.series).toHaveLength(2);
  });
});

describe("buildSeries — funnel", () => {
  it("returns the four analytics-funnel stages with rates between them", () => {
    const bundle = fakeBundle();
    bundle.analytics["1"] = [
      { day: "2026-05-22", impressions: 1000, pageViews: 200, sessions: 60, downloads: 30,
        activeDevices: 50, deletions: 0, crashes: 0, bySource: {} },
    ];
    const card: ChartCard = { ...baseCard, viz: "funnel", appIds: "all", range: "7d" };
    const r = buildSeries(card, bundle);
    if (r.kind !== "funnel") throw new Error();
    expect(r.stages.map((s) => s.label)).toEqual(["Impressions", "Page views", "Sessions", "Downloads"]);
    expect(r.stages[0].value).toBe(1000);
    expect(r.stages[3].value).toBe(30);
    expect(r.stages[1].rate).toBeCloseTo(200 / 1000, 3);
    expect(r.stages[3].rate).toBeCloseTo(30 / 60, 3);
  });
});
