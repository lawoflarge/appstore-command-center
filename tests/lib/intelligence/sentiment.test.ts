import { test, expect, vi } from "vitest";
import { clusterReviews } from "@/lib/intelligence/sentiment";

test("clusterReviews parses JSON theme output and only sends new reviews", async () => {
  const complete = vi.fn(async () => JSON.stringify({
    themes: [{ label: "Crashes", count: 1, sentiment: "negative", exampleIds: ["r2"] }],
  }));
  const res = await clusterReviews(
    { complete } as any,
    [{ id: "r2", rating: 2, title: "Crash", body: "Crashes", reviewer: "x", territory: "NLD", createdDate: "2026-05-19", responded: false }],
  );
  expect(res.themes[0].label).toBe("Crashes");
  expect(complete.mock.calls[0][1]).toContain("r2");
});

test("clusterReviews short-circuits on empty input", async () => {
  const complete = vi.fn();
  const res = await clusterReviews({ complete } as any, []);
  expect(res.themes).toEqual([]);
  expect(complete).not.toHaveBeenCalled();
});
