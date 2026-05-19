import { test, expect } from "vitest";
import { detectAnomalies } from "@/lib/intelligence/anomaly";

const series = [
  { day: "2026-04-20", value: 100 }, { day: "2026-04-27", value: 100 },
  { day: "2026-05-04", value: 100 }, { day: "2026-05-11", value: 100 },
  { day: "2026-05-18", value: 20 },
];

test("flags a drop and attaches release cause when near a release", () => {
  const a = detectAnomalies({
    appId: "1", metric: "downloads", series, day: "2026-05-18",
    releases: [{ version: "1.2", date: "2026-05-18" }],
  });
  expect(a).not.toBeNull();
  expect(a!.direction).toBe("drop");
  expect(a!.cause).toContain("release");
});

test("no anomaly within normal variation", () => {
  const flat = series.slice(0, 4).concat({ day: "2026-05-18", value: 101 });
  expect(detectAnomalies({ appId: "1", metric: "downloads", series: flat, day: "2026-05-18", releases: [] })).toBeNull();
});
