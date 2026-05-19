import { test, expect } from "vitest";
import { diagnoseFunnel } from "@/lib/intelligence/funnel";

test("flags page-view→install as the leaking stage vs baseline", () => {
  const baseline = { impressions: 1000, pageViews: 300, downloads: 90 }; // 30% / 30%
  const today = { impressions: 1000, pageViews: 300, downloads: 30 };    // 30% / 10%
  const d = diagnoseFunnel(today, baseline);
  expect(d.leak).toBe("pageView_to_install");
  expect(d.message).toContain("conversion");
});

test("no leak when within tolerance", () => {
  const b = { impressions: 1000, pageViews: 300, downloads: 90 };
  expect(diagnoseFunnel({ impressions: 1000, pageViews: 300, downloads: 88 }, b).leak).toBe("none");
});
