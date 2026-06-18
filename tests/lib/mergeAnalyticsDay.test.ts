import { test, expect } from "vitest";
import { mergeAnalyticsDay } from "@/lib/orchestrator";

const day = (over: Record<string, unknown> = {}) => ({
  day: "2026-06-02", impressions: 0, pageViews: 0, downloads: 0,
  sessions: 0, activeDevices: 0, deletions: 0, crashes: 0, bySource: {}, ...over,
}) as any;

// The bug: Apple's rolling report drops a date to 0 ~16 days later; newest-wins then wiped the
// real count. mergeAnalyticsDay must keep the recorded positive when the re-fetch reports 0.
test("keeps a recorded positive when the re-fetched day reports 0 downloads", () => {
  const prev = day({ downloads: 35, bySource: { "App Store search": 30 } });
  const inc = day({ downloads: 0, impressions: 12 });
  const m = mergeAnalyticsDay(prev, inc);
  expect(m.downloads).toBe(35);
  expect(m.bySource).toEqual({ "App Store search": 30 });
  expect(m.impressions).toBe(12); // genuine new engagement data is still applied
});

test("honors a genuine non-zero downward revision (estimates settling)", () => {
  const prev = day({ downloads: 35 });
  const inc = day({ downloads: 30, bySource: { "App Store search": 30 } });
  const m = mergeAnalyticsDay(prev, inc);
  expect(m.downloads).toBe(30);
  expect(m.bySource).toEqual({ "App Store search": 30 });
});

test("a 0-impressions re-fetch cannot wipe recorded impressions/pageViews", () => {
  const prev = day({ impressions: 100, pageViews: 40 });
  const inc = day({ downloads: 5, impressions: 0, pageViews: 0 });
  const m = mergeAnalyticsDay(prev, inc);
  expect(m.impressions).toBe(100);
  expect(m.pageViews).toBe(40);
  expect(m.downloads).toBe(5);
});
