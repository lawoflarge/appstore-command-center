import { test, expect, vi } from "vitest";
import { buildDigest, isDigestDay } from "@/lib/intelligence/digest";

test("isDigestDay true on Monday only", () => {
  expect(isDigestDay("2026-05-18")).toBe(true);   // Monday
  expect(isDigestDay("2026-05-19")).toBe(false);  // Tuesday
});

test("buildDigest passes a compact summary and returns narrative", async () => {
  const complete = vi.fn(async () => "## This week\n- Downloads up 12%");
  const out = await buildDigest({ complete } as any, { totalDownloads: 500, wowPct: 12, topAnomalies: [], opportunities: [] });
  expect(out).toContain("This week");
  expect(complete.mock.calls[0][1]).toContain("500");
});
