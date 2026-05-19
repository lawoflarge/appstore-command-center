import { test, expect } from "vitest";
import { zScore } from "@/lib/intelligence/baseline";

test("zScore uses same-weekday history", () => {
  // 4 prior Mondays at ~100, today Monday = 160 → high z
  const series = [
    { day: "2026-04-20", value: 100 }, { day: "2026-04-27", value: 102 },
    { day: "2026-05-04", value: 98 }, { day: "2026-05-11", value: 100 },
    { day: "2026-05-18", value: 160 },
  ];
  const z = zScore(series, "2026-05-18");
  expect(z!.z).toBeGreaterThan(3);
  expect(z!.baseline).toBeCloseTo(100, 0);
});

test("zScore returns null with too few same-weekday points", () => {
  expect(zScore([{ day: "2026-05-18", value: 10 }], "2026-05-18")).toBeNull();
});
