import { test, expect, vi, afterEach } from "vitest";
import { collectKeywordRanks } from "@/lib/sources/keywords";

afterEach(() => vi.restoreAllMocks());

test("collectKeywordRanks finds 1-based rank or null", async () => {
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const term = new URL(u).searchParams.get("term");
    const results = term === "rate tracker"
      ? [{ trackId: 999 }, { trackId: 123 }]
      : [{ trackId: 5 }, { trackId: 6 }];
    return new Response(JSON.stringify({ results }), { status: 200 });
  }));
  const r = await collectKeywordRanks("123",
    [{ term: "rate tracker", country: "de" }, { term: "nope", country: "de" }], "2026-05-19");
  expect(r).toEqual([
    { day: "2026-05-19", term: "rate tracker", country: "de", rank: 2 },
    { day: "2026-05-19", term: "nope", country: "de", rank: null },
  ]);
});
