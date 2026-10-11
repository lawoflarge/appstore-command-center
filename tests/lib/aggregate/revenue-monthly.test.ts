import { describe, expect, it } from "vitest";
import { buildMonthlyRevenue } from "@/lib/aggregate/revenue-monthly";
import type { SalesDay, AdMobReportCoverage } from "@/lib/store/paths";
import type { AdMobRow } from "@/lib/sources/admob";

function sale(day: string, oneTime: number, subscription = 0, other = 0): SalesDay {
  return { day, byCountry: {}, total: 0, redownloads: 0, proceedsUsd: oneTime + subscription + other,
    proceedsEur: oneTime + subscription + other, proceedsEurByType: { oneTime, subscription, other },
    reportAvailable: true, collectedAt: `${day}T12:00:00Z` };
}
function ad(day: string, earnings: number, appId = "ad-1"): AdMobRow {
  return { day, earnings, appId, app: appId, adUnit: "banner", impressions: 100, clicks: 1,
    requests: 100, matchedRequests: 100, ecpm: earnings * 10 };
}
function coverage(endDay: string, startDay = `${endDay.slice(0, 7)}-01`): AdMobReportCoverage {
  return { startDay, endDay, completeThroughDay: endDay, reportingTimeZone: "Europe/Berlin", currencyCode: "EUR", collectedAt: `${endDay}T23:00:00Z` };
}
const app = (sales: SalesDay[], appId = "app-1") => ({ appId, name: appId, sales });

describe("monthly revenue", () => {
  it("projects over elapsed calendar days through source cutoffs, excluding partial advertising", () => {
    const result = buildMonthlyRevenue([app([sale("2026-10-01", 8, 4), sale("2026-10-08", 0)])],
      [ad("2026-10-01", 3), ad("2026-10-09", 6), ad("2026-10-10", 90)], "2026-10", "2026-10-10", "2026-10-10", coverage("2026-10-09"));
    expect(result.totals).toMatchObject({ oneTime: 8, subscriptions: 4, ads: 99, total: 111 });
    expect(result.forecast).toEqual({ oneTime: 31, subscriptions: 15.5, ads: 31, total: 77.5,
      appleThrough: "2026-10-08", adsThrough: "2026-10-09", appleDays: 8, adDays: 9 });
  });

  it("does not confuse latest transaction with confirmed report coverage or missing apps with zero", () => {
    const result = buildMonthlyRevenue([app([sale("2026-10-08", 8)]), app([], "app-2")],
      [ad("2026-10-08", 8)], "2026-10", "2026-10-10", "2026-10-10", coverage("2026-10-08"));
    expect(result.forecast.appleThrough).toBeNull();
    expect(result.forecast.oneTime).toBeNull();
    expect(result.forecast.total).toBeNull();
    expect(result.forecast.ads).toBe(31);
  });

  it("uses the slowest app report and does not include fresher app proceeds beyond it in the forecast", () => {
    const result = buildMonthlyRevenue([app([sale("2026-10-08", 8), sale("2026-10-09", 90)]),
      app([sale("2026-10-08", 8)], "app-2")], [ad("2026-10-08", 8)], "2026-10", "2026-10-10", "2026-10-10", coverage("2026-10-08"));
    expect(result.forecast.appleDays).toBe(8);
    expect(result.forecast.oneTime).toBe(62);
    expect(result.totals.oneTime).toBe(106);
  });

  it("retains negative refund-only months and does not forecast historical months", () => {
    const result = buildMonthlyRevenue([app([sale("2026-09-09", -4, -2)])], [], "2026-09", "2026-10-10");
    expect(result.byApp[0].total).toBe(-6);
    expect(result.totals.total).toBe(-6);
    expect(result.forecast.total).toBeNull();
    expect(result.isCurrentMonth).toBe(false);
  });

  it("keeps unsplit history visible without manufacturing subscription or one-time totals", () => {
    const legacy = sale("2026-10-08", 8);
    delete legacy.proceedsEurByType;
    const result = buildMonthlyRevenue([app([legacy])], [ad("2026-10-08", 2)], "2026-10", "2026-10-10", "2026-10-10", coverage("2026-10-08"));
    expect(result.totals).toMatchObject({ oneTime: null, subscriptions: null, unclassifiedApple: 8, total: 10 });
    expect(result.classificationComplete).toBe(false);
    expect(result.forecast.total).toBeNull();
  });

  it("treats a legacy zero-net transaction bucket as unclassified", () => {
    const row = sale("2026-10-08", 0);
    delete row.proceedsEurByType;
    row.proceedsByCcy = { EUR: 0 };
    const result = buildMonthlyRevenue([app([row])], [], "2026-10", "2026-10-10", "2026-10-10", coverage("2026-10-08"));
    expect(result.classificationComplete).toBe(false);
    expect(result.totals.oneTime).toBeNull();
  });

  it("never treats a foreign or mixed-currency legacy total as EUR", () => {
    const row: SalesDay = { day: "2026-10-08", byCountry: {}, total: 0, redownloads: 0,
      proceedsUsd: 1000, proceedsByCcy: { JPY: 1000 } };
    const result = buildMonthlyRevenue([app([row])], [], "2026-10", "2026-10-10", "2026-10-10", coverage("2026-10-08"));
    expect(result.missingFxRows).toBe(1);
    expect(result.classificationComplete).toBe(false);
    expect(result.totals.total).toBe(0);
    expect(result.forecast.total).toBeNull();
  });

  it("reconciles rounding across app, daily, monthly and category totals including refunds", () => {
    const result = buildMonthlyRevenue([
      app([sale("2026-10-08", 0.335, 0.335), sale("2026-10-09", -0.335)]),
      app([sale("2026-10-08", 0.335), sale("2026-10-09", -0.335)], "app-2"),
    ], [ad("2026-10-08", 0.335), ad("2026-10-08", 0.335, "ad-2")], "2026-10", "2026-10-10", "2026-10-10", coverage("2026-10-08"));
    expect(result.totals.total).toBe(1.01);
    expect(result.byApp.reduce((sum, row) => sum + row.total, 0)).toBeCloseTo(result.totals.total - result.totals.ads);
    expect(result.byDay.reduce((sum, row) => sum + row.total, 0)).toBeCloseTo(result.totals.total);
    expect(result.totals.oneTime! + result.totals.subscriptions! + result.totals.ads).toBeCloseTo(result.totals.total);
  });

  it("deduplicates repeated partitions and omits records outside the selected month", () => {
    const row = sale("2026-10-08", 8);
    const ads = ad("2026-10-08", 2);
    const result = buildMonthlyRevenue([app([sale("2026-09-30", 100), row, row])], [ads, ads], "2026-10", "2026-10-10", "2026-10-10", coverage("2026-10-08"));
    expect(result.totals.total).toBe(10);
  });

  it("uses advertising report timezone to identify incomplete days at a month boundary", () => {
    const result = buildMonthlyRevenue([app([sale("2026-10-30", 30)])],
      [ad("2026-10-31", 31)], "2026-10", "2026-10-31", "2026-11-01", coverage("2026-10-31"));
    expect(result.forecast.ads).toBe(31);
    expect(result.forecast.adDays).toBe(31);
  });

  it("preserves other paid Apple product types separately", () => {
    const result = buildMonthlyRevenue([app([sale("2026-10-08", 8, 4, 2)])], [ad("2026-10-08", 8)], "2026-10", "2026-10-10", "2026-10-10", coverage("2026-10-08"));
    expect(result.totals.otherApple).toBe(2);
    expect(result.totals.total).toBe(22);
    expect(result.forecast.total).toBe(85.25);
  });

  it("uses the correct month length and rejects impossible month keys", () => {
    const result = buildMonthlyRevenue([app([sale("2028-02-10", 10)])], [ad("2028-02-10", 10)], "2028-02", "2028-02-11", "2028-02-11", coverage("2028-02-10"));
    expect(result.daysInMonth).toBe(29);
    expect(result.forecast.total).toBe(58);
    expect(() => buildMonthlyRevenue([], [], "2026-13", "2026-10-10")).toThrow("Invalid revenue month");
  });
});


it("does not manufacture zero Apple categories when no report exists", () => {
  for (const ads of [[], [ad("2026-10-08", 2)]]) {
    const result = buildMonthlyRevenue([app([])], ads, "2026-10", "2026-10-10");
    expect(result.totals.oneTime).toBeNull();
    expect(result.totals.subscriptions).toBeNull();
    expect(result.latestAppleDay).toBeNull();
  }
});

it("keeps cancelled unknown revenue unknown per app", () => {
  const positive = sale("2026-10-07", 10);
  const negative = sale("2026-10-08", -10);
  delete positive.proceedsEurByType; delete negative.proceedsEurByType;
  const result = buildMonthlyRevenue([app([positive, negative, sale("2026-10-09", 5)])], [], "2026-10", "2026-10-10");
  expect(result.byApp[0]).toMatchObject({ total: 5, unclassifiedApple: 0, classificationComplete: false });
});

it("does not accept a partial EUR bucket when another currency is missing", () => {
  const row = { ...sale("2026-10-09", 30), proceedsByCcy: { EUR: 10 }, proceedsCurrencyMissing: true as const };
  delete row.proceedsEur;
  const result = buildMonthlyRevenue([app([row])], [], "2026-10", "2026-10-10");
  expect(result.missingFxRows).toBe(1);
  expect(result.totals.total).toBe(0);
  expect(result.totals.oneTime).toBeNull();
});

it("uses confirmed report coverage including trailing days without activity", () => {
  const result = buildMonthlyRevenue([app([sale("2026-10-09", 9)])], [ad("2026-10-06", 9)],
    "2026-10", "2026-10-10", "2026-10-10", coverage("2026-10-09"));
  expect(result.forecast).toMatchObject({ adsThrough: "2026-10-09", adDays: 9, ads: 31 });
  const empty = buildMonthlyRevenue([app([sale("2026-10-09", 9)])], [],
    "2026-10", "2026-10-10", "2026-10-10", coverage("2026-10-09"));
  expect(empty.forecast.ads).toBe(0);
  expect(empty.latestAdmobDay).toBe("2026-10-09");
});

it("does not forecast ads without confirmed full-month report coverage", () => {
  const ads = [ad("2026-10-09", 9)];
  expect(buildMonthlyRevenue([], ads, "2026-10", "2026-10-10").forecast.ads).toBeNull();
  expect(buildMonthlyRevenue([], ads, "2026-10", "2026-10-10", "2026-10-10", coverage("2026-10-09", "2026-10-05")).forecast.ads).toBeNull();
});
