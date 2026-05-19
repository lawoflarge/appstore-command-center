import { test, expect } from "vitest";
import { keywordOpportunities } from "@/lib/intelligence/keywords";

test("surfaces terms ranked 8-25, best (lowest rank) first", () => {
  const hist = [
    { day: "2026-05-17", term: "a", country: "de", rank: 12 },
    { day: "2026-05-18", term: "a", country: "de", rank: 10 },
    { day: "2026-05-18", term: "b", country: "de", rank: 40 },
    { day: "2026-05-18", term: "c", country: "de", rank: 9 },
  ];
  const o = keywordOpportunities(hist, "2026-05-18");
  expect(o.map((x) => x.term)).toEqual(["c", "a"]);
  expect(o[0]).toMatchObject({ term: "c", rank: 9, trend: "flat" });
  expect(o[1]).toMatchObject({ term: "a", rank: 10, trend: "improving" });
});
