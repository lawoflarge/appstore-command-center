import { describe, expect, it } from "vitest";
import { prepareSalesBackfill } from "@/lib/sources/revenueBackfill";
import type { SalesDay } from "@/lib/store/paths";

function day(extra: Partial<SalesDay> = {}): SalesDay {
  return { day: "2026-09-01", byCountry: { DE: 7 }, total: 7, redownloads: 1, proceedsUsd: 12, proceedsByCcy: { USD: 12 }, proceedsEur: 10, ...extra };
}
function source(split: NonNullable<SalesDay["proceedsByType"]>, extra: Partial<SalesDay> = {}): SalesDay {
  return day({ reportAvailable: true, collectedAt: "2026-10-10T12:00:00Z", proceedsByType: split, otherProductTypes: [], ...extra });
}
describe("revenue backfill", () => {
  it("preserves the existing EUR total exactly for a single type and all unrelated fields", () => {
    const original = { ...day(), customExistingField: "keep" };
    const result = prepareSalesBackfill(original, source({ oneTime: {}, subscription: { USD: 12 }, other: {} }));
    expect(result.kind).toBe("single_type");
    if (result.kind === "exception") return;
    expect(result.row).toMatchObject(original);
    expect(result.row.proceedsEurByType).toEqual({ oneTime: 0, subscription: 10, other: 0 });
  });
  it("splits a single currency with the stored exchange rate and reconciles rounding", () => {
    const result = prepareSalesBackfill(day(), source({ oneTime: { USD: 4 }, subscription: { USD: 8 }, other: {} }));
    expect(result.kind).toBe("single_currency");
    if (result.kind === "exception") return;
    expect(result.row.proceedsEurByType).toEqual({ oneTime: 3.33, subscription: 6.67, other: 0 });
  });
  it("does not silently rescale a multiple-currency split when historical FX differs", () => {
    const old = day({ proceedsByCcy: { USD: 10, EUR: 2 } });
    const raw = source({ oneTime: { USD: 10 }, subscription: { EUR: 2 }, other: {} }, { proceedsByCcy: { USD: 10, EUR: 2 } });
    expect(prepareSalesBackfill(old, raw).kind).toBe("exception");
    expect(prepareSalesBackfill(old, raw, { USD: 2 }).kind).toBe("exception");
    const valid = prepareSalesBackfill(old, raw, { USD: 1.25 });
    expect(valid.kind).toBe("verified_fx");
    if (valid.kind !== "exception") expect(valid.row.proceedsEurByType).toEqual({ oneTime: 8, subscription: 2, other: 0 });
  });
  it("blocks upstream corrections rather than overwriting the historical totals", () => {
    const raw = source({ oneTime: { USD: 13 }, subscription: {}, other: {} }, { proceedsByCcy: { USD: 13 }, proceedsUsd: 13 });
    expect(prepareSalesBackfill(day(), raw).kind).toBe("exception");
  });
  it("does not erase a cross-type sale and refund that net to zero", () => {
    const old = day({ proceedsByCcy: { EUR: 0 }, proceedsUsd: 0, proceedsEur: 0 });
    const raw = source({ oneTime: { EUR: 5 }, subscription: { EUR: -5 }, other: {} }, { proceedsByCcy: { EUR: 0 }, proceedsUsd: 0 });
    expect(prepareSalesBackfill(old, raw).kind).toBe("exception");
    const valid = prepareSalesBackfill(old, raw, {});
    expect(valid.kind).toBe("verified_fx");
    if (valid.kind !== "exception") expect(valid.row.proceedsEurByType).toEqual({ oneTime: 5, subscription: -5, other: 0 });
  });
});
