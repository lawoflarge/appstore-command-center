import { test, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ensureOngoingRequest, parseAnalyticsCsv, parseAnalyticsCsvs } from "@/lib/sources/analytics";

const engagementCsv = readFileSync(__dirname + "/../../fixtures/analytics-app-store-engagement.csv", "utf8");
const downloadsCsv = readFileSync(__dirname + "/../../fixtures/analytics-app-downloads.csv", "utf8");

test("parseAnalyticsCsv handles long-format engagement CSV (impressions + page views)", () => {
  const days = parseAnalyticsCsv(engagementCsv);
  expect(days["2026-05-18"]).toMatchObject({
    day: "2026-05-18",
    impressions: 1600,
    pageViews: 390,
    downloads: 0,
  });
  expect(days["2026-05-19"]).toMatchObject({
    day: "2026-05-19", impressions: 800, pageViews: 200, downloads: 0,
  });
});

test("parseAnalyticsCsv handles long-format downloads CSV (First-time only, splits bySource)", () => {
  const days = parseAnalyticsCsv(downloadsCsv);
  expect(days["2026-05-18"]).toMatchObject({
    day: "2026-05-18",
    downloads: 100,
    impressions: 0,
    pageViews: 0,
    bySource: { "App Store search": 80, "App Store browse": 20 },
  });
  expect(days["2026-05-19"].downloads).toBe(60);
});

test("parseAnalyticsCsvs merges multiple chunks into one AnalyticsDay per date", () => {
  const days = parseAnalyticsCsvs([engagementCsv, downloadsCsv]);
  expect(days["2026-05-18"]).toMatchObject({
    day: "2026-05-18",
    impressions: 1600,
    pageViews: 390,
    downloads: 100,
    bySource: { "App Store search": 80, "App Store browse": 20 },
  });
});

test("parseAnalyticsCsvs ignores empty chunks and unrecognized schemas", () => {
  const days = parseAnalyticsCsvs(["", "\n\n", "Date,Foo\n2026-05-18,1"]);
  expect(Object.keys(days)).toEqual([]);
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
