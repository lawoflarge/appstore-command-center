import { test, expect, vi, afterEach } from "vitest";
import { collectRatings } from "@/lib/sources/ratings";

afterEach(() => vi.restoreAllMocks());

test("collectRatings aggregates per-country into a RatingPoint", async () => {
  const byCountry: Record<string, any> = {
    de: { results: [{ averageUserRating: 4.6, userRatingCount: 100 }] },
    us: { results: [{ averageUserRating: 4.0, userRatingCount: 100 }] },
  };
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const c = new URL(u).searchParams.get("country")!;
    return new Response(JSON.stringify(byCountry[c]), { status: 200 });
  }));
  const r = await collectRatings("123", ["de", "us"], "2026-05-19");
  expect(r.day).toBe("2026-05-19");
  expect(r.byCountry.de).toEqual({ avg: 4.6, count: 100 });
  expect(r.count).toBe(200);
  expect(r.avg).toBeCloseTo(4.3, 5);
});

test("collectRatings skips countries with no result", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })));
  const r = await collectRatings("123", ["de"], "2026-05-19");
  expect(r.count).toBe(0);
  expect(r.avg).toBe(0);
});
