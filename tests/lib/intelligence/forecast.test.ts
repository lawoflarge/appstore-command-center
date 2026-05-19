import { test, expect } from "vitest";
import { forecastMonth } from "@/lib/intelligence/forecast";

test("projects month total from run-rate", () => {
  // 10 days, 10/day → as of 2026-05-10, May has 31 days → ~310
  const series = Array.from({ length: 10 }, (_, i) => ({ day: `2026-05-${String(i + 1).padStart(2, "0")}`, value: 10 }));
  const f = forecastMonth(series, "2026-05-10");
  expect(f.projected).toBeCloseTo(310, 0);
  expect(f.soFar).toBe(100);
  expect(f.band.low).toBeLessThanOrEqual(f.projected);
  expect(f.band.high).toBeGreaterThanOrEqual(f.projected);
});
