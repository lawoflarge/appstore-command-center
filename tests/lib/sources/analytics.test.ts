import { test, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ensureOngoingRequest, parseAnalyticsCsv } from "@/lib/sources/analytics";

const csv = readFileSync(__dirname + "/../../fixtures/analytics-app-store-engagement.csv", "utf8");

test("parseAnalyticsCsv folds rows into one AnalyticsDay with bySource", () => {
  const day = parseAnalyticsCsv(csv);
  expect(day["2026-05-18"]).toEqual({
    day: "2026-05-18",
    impressions: 1600, pageViews: 390, downloads: 100,
    sessions: 640, activeDevices: 540, deletions: 13, crashes: 0,
    bySource: { "App Store Search": 80, "App Store Browse": 20 },
  });
});

test("ensureOngoingRequest creates when none exist", async () => {
  const create = vi.fn(async () => ({ id: "req1" }));
  const list = vi.fn(async () => []);
  const id = await ensureOngoingRequest("app1", list, create);
  expect(create).toHaveBeenCalledWith("app1");
  expect(id).toBe("req1");
});

test("ensureOngoingRequest reuses existing", async () => {
  const create = vi.fn();
  const list = vi.fn(async () => [{ id: "existing" }]);
  expect(await ensureOngoingRequest("app1", list, create as any)).toBe("existing");
  expect(create).not.toHaveBeenCalled();
});
