import { test, expect } from "vitest";
import { migrateSlice } from "@/lib/dashboards/migrate";
import type { ChartCard, DashboardSlice } from "@/lib/dashboards/types";

const card = (over: Partial<ChartCard>): ChartCard => ({
  id: "x", title: "T", metric: "downloads", viz: "area",
  appIds: "all", range: "30d", bucket: "day", breakdown: "none", compare: "none",
  ...over,
});

test("the dead 'Active devices' glance card is healed to downloads", () => {
  const slice: DashboardSlice = {
    updatedAt: "2026-05-26T08:53:16.815Z",
    cards: [card({ title: "Active devices", metric: "activeDevices", viz: "stackedArea", breakdown: "app", range: "90d" })],
  };
  const out = migrateSlice(slice);
  expect(out.cards[0].metric).toBe("downloads");
  expect(out.cards[0].title).toBe("Downloads");
  // viz / breakdown / range survive so the chart still renders something useful
  expect(out.cards[0].viz).toBe("stackedArea");
  expect(out.cards[0].breakdown).toBe("app");
});

test("all four uncollectable metrics migrate", () => {
  for (const m of ["sessions", "activeDevices", "deletions", "crashes"] as const) {
    const out = migrateSlice({ updatedAt: "t", cards: [card({ metric: m })] });
    expect(out.cards[0].metric).toBe("downloads");
  }
});

test("a user-renamed dead card keeps its custom title", () => {
  const out = migrateSlice({ updatedAt: "t", cards: [card({ title: "My retention", metric: "activeDevices" })] });
  expect(out.cards[0].metric).toBe("downloads");
  expect(out.cards[0].title).toBe("My retention");
});

test("a clean slice is returned by reference (no churn)", () => {
  const slice: DashboardSlice = { updatedAt: "t", cards: [card({ metric: "downloads" }), card({ metric: "avgRating" })] };
  expect(migrateSlice(slice)).toBe(slice);
});
