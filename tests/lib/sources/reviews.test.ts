import { test, expect } from "vitest";
import raw from "../../fixtures/asc-reviews.json";
import { mapReviews, mergeReviews } from "@/lib/sources/reviews";

test("mapReviews normalizes + responded flag", () => {
  const r = mapReviews(raw as any);
  expect(r[0]).toEqual({ id: "r1", rating: 5, title: "Great", body: "Love it", reviewer: "Max", territory: "DEU", createdDate: "2026-05-18T10:00:00Z", responded: false });
  expect(r[1].responded).toBe(true);
});

test("mergeReviews dedupes by id keeping newest mapping", () => {
  const a = [{ id: "r1", rating: 5, title: "", body: "", reviewer: "", territory: "", createdDate: "2026-05-18T10:00:00Z", responded: false }];
  const b = [{ id: "r1", rating: 5, title: "", body: "", reviewer: "", territory: "", createdDate: "2026-05-18T10:00:00Z", responded: true }];
  expect(mergeReviews(a, b)).toHaveLength(1);
  expect(mergeReviews(a, b)[0].responded).toBe(true);
});
