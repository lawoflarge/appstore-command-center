import { describe, it, expect } from "vitest";
import { buildRevenue } from "@/lib/aggregate/revenue";
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
