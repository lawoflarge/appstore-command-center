import { test, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ensureOngoingRequest, parseAnalyticsCsv, parseAnalyticsCsvs, parseAnalyticsGroups } from "@/lib/sources/analytics";

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

// Apple's ONGOING DAILY analytics instances each restate a rolling window, so the SAME
// calendar date appears in several instances. Summing them double-counts (the real NetGuard
// bug: 2026-06-01 showed 26 = 13+13). Per report, each date must come from its newest instance.
const DL = "App Downloads Standard";
const ENG = "App Store Discovery and Engagement Standard";

test("parseAnalyticsGroups dedupes overlapping daily instances (newest wins per date)", () => {
  const days = parseAnalyticsGroups([
    { report: DL, processingDate: "2026-06-03", segments: [
      "Date,Counts,Download Type,Source Type\n2026-06-02,35,First-time download,App Store search\n2026-06-01,13,First-time download,App Store search\n",
    ] },
    { report: DL, processingDate: "2026-06-02", segments: [
      "Date,Counts,Download Type,Source Type\n2026-06-01,13,First-time download,App Store search\n",
    ] },
  ]);
  expect(days["2026-06-01"].downloads).toBe(13); // not 26
  expect(days["2026-06-02"].downloads).toBe(35);
});

test("parseAnalyticsGroups sums multiple segments within a single instance", () => {
  const days = parseAnalyticsGroups([
    { report: DL, processingDate: "2026-06-03", segments: [
      "Date,Counts,Download Type,Source Type\n2026-06-01,8,First-time download,App referrer\n",
      "Date,Counts,Download Type,Source Type\n2026-06-01,5,First-time download,App Store search\n",
    ] },
  ]);
  expect(days["2026-06-01"].downloads).toBe(13);
  expect(days["2026-06-01"].bySource).toEqual({ "App referrer": 8, "App Store search": 5 });
});

test("parseAnalyticsGroups merges downloads + engagement reports for the same date", () => {
  const days = parseAnalyticsGroups([
    { report: DL, processingDate: "2026-06-03", segments: [
      "Date,Counts,Download Type\n2026-06-01,13,First-time download\n",
    ] },
    { report: ENG, processingDate: "2026-06-03", segments: [
      "Date,Counts,Event\n2026-06-01,100,Impression\n2026-06-01,40,Page view\n",
    ] },
  ]);
  expect(days["2026-06-01"]).toMatchObject({ downloads: 13, impressions: 100, pageViews: 40 });
});
