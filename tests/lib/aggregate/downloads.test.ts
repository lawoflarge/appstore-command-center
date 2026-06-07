import { test, expect } from "vitest";
import { downloadsSeries, totals, analyticsTotals } from "@/lib/aggregate/downloads";
import type { AnalyticsDay } from "@/lib/store/paths";

const sales = [
  { day: "2026-05-17", byCountry: { DE: 5 }, total: 5, redownloads: 0, proceedsUsd: 0 },
  { day: "2026-05-18", byCountry: { DE: 7, US: 1 }, total: 8, redownloads: 0, proceedsUsd: 0 },
];

const analytics: AnalyticsDay[] = [
  { day: "2026-05-17", impressions: 0, pageViews: 0, downloads: 5, sessions: 0, activeDevices: 0, deletions: 0, crashes: 0, bySource: {} },
  { day: "2026-05-18", impressions: 0, pageViews: 0, downloads: 8, sessions: 0, activeDevices: 0, deletions: 0, crashes: 0, bySource: {} },
];

test("downloadsSeries returns {day,value}", () => {
  expect(downloadsSeries(sales)).toEqual([
    { day: "2026-05-17", value: 5 }, { day: "2026-05-18", value: 8 },
  ]);
});

test("totals computes total + today + delta", () => {
  expect(totals(sales, "2026-05-18")).toEqual({ total: 13, today: 8, prev: 5, deltaPct: 60 });
});

test("totals returns today=null when the requested day has no row (distinguish 'no data' from a real 0)", () => {
  expect(totals(sales, "2026-05-19").today).toBeNull();
});

test("analyticsTotals returns today=null when the requested day has no row", () => {
  expect(analyticsTotals(analytics, "2026-05-18").today).toBe(8);
  expect(analyticsTotals(analytics, "2026-05-19").today).toBeNull();
});
