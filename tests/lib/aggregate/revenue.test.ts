import { describe, it, expect } from "vitest";
import { buildRevenue, buildIapBreakdown } from "@/lib/aggregate/revenue";
import type { AdMobRow } from "@/lib/sources/admob";
import type { SalesDay } from "@/lib/store/paths";

const ad = (day: string, earnings: number): AdMobRow => ({
  day, appId: "a", app: "App", adUnit: "u", earnings,
  impressions: 0, clicks: 0, requests: 0, matchedRequests: 0, ecpm: 0,
});
const sale = (day: string, proceedsUsd: number): SalesDay => ({
  day, byCountry: {}, total: 0, redownloads: 0, proceedsUsd,
});

describe("buildRevenue", () => {
  it("merges ad earnings and IAP proceeds by day", () => {
    const r = buildRevenue(
      [ad("2026-05-20", 1.0), ad("2026-05-20", 0.5), ad("2026-05-21", 2.0)],
      [sale("2026-05-21", 3.0), sale("2026-05-22", 1.0)],
    );
    expect(r.adEarnings).toBe(3.5);
    expect(r.iapProceeds).toBe(4.0);
    expect(r.total).toBe(7.5);
    expect(r.byDay).toEqual([
      { day: "2026-05-20", ad: 1.5, iap: 0, total: 1.5 },
      { day: "2026-05-21", ad: 2.0, iap: 3.0, total: 5.0 },
      { day: "2026-05-22", ad: 0, iap: 1.0, total: 1.0 },
    ]);
  });

  it("computes ad/iap share and is zero-safe", () => {
    const r = buildRevenue([ad("2026-05-20", 3.0)], [sale("2026-05-20", 1.0)]);
    expect(r.adShare).toBeCloseTo(0.75, 5);
    expect(r.iapShare).toBeCloseTo(0.25, 5);

    const empty = buildRevenue([], []);
    expect(empty.total).toBe(0);
    expect(empty.adShare).toBe(0);
    expect(empty.byDay).toEqual([]);
  });
});

describe("buildIapBreakdown", () => {
  const s = (day: string, proceedsUsd: number): SalesDay => ({ day, byCountry: {}, total: 0, redownloads: 0, proceedsUsd });

  it("breaks IAP/subscription proceeds down per app and per day, dropping zero-proceeds apps", () => {
    const r = buildIapBreakdown([
      { appId: "1", name: "NetGuard", sales: [s("2026-06-02", 6.38), s("2026-06-05", 3.39)] },
      { appId: "2", name: "Soccer",   sales: [s("2026-06-05", 0)] },
      { appId: "3", name: "PulseCheck", sales: [s("2026-06-02", 1.0)] },
    ]);
    expect(r.totalProceeds).toBe(10.77);
    // sorted by proceeds desc, apps with 0 excluded
    expect(r.byApp).toEqual([
      { appId: "1", name: "NetGuard", proceeds: 9.77 },
      { appId: "3", name: "PulseCheck", proceeds: 1.0 },
    ]);
    // per-day proceeds summed across apps, ordered
    expect(r.byDay).toEqual([
      { day: "2026-06-02", proceeds: 7.38 },
      { day: "2026-06-05", proceeds: 3.39 },
    ]);
    expect(r.appsWithRevenue).toBe(2);
  });

  it("is empty-safe", () => {
    const r = buildIapBreakdown([{ appId: "1", name: "X", sales: [] }]);
    expect(r).toEqual({ totalProceeds: 0, byApp: [], byDay: [], appsWithRevenue: 0 });
  });
});

describe("EUR conversion (proceedsEur)", () => {
  // A real NetGuard Pro sale in Brazil: the legacy raw lump is 18.49 (overstated, counted as €),
  // the FX-converted figure is ~3.14 €. Both revenue surfaces must report the EUR value and only
  // fall back to proceedsUsd when proceedsEur is absent (pre-backfill rows).
  const brl: SalesDay = {
    day: "2026-06-23", byCountry: {}, total: 0, redownloads: 0,
    proceedsUsd: 18.49, proceedsByCcy: { BRL: 18.49 }, proceedsEur: 3.14,
  };

  it("prefers proceedsEur over the raw proceedsUsd in buildRevenue", () => {
    expect(buildRevenue([], [brl]).iapProceeds).toBe(3.14);
  });

  it("prefers proceedsEur over the raw proceedsUsd in buildIapBreakdown", () => {
    const bd = buildIapBreakdown([{ appId: "1", name: "NetGuard", sales: [brl] }]);
    expect(bd.totalProceeds).toBe(3.14);
    expect(bd.byApp[0].proceeds).toBe(3.14);
  });
});
