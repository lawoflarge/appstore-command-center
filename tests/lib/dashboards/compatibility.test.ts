// tests/lib/dashboards/compatibility.test.ts
import { describe, it, expect } from "vitest";
import { isVizCompatible, isBreakdownCompatible, vizForMetric } from "@/lib/dashboards/compatibility";

describe("isVizCompatible", () => {
  it("allows area for downloads", () => {
    expect(isVizCompatible("downloads", "area")).toBe(true);
  });
  it("rejects funnel for downloads (funnel is a synthetic viz, not metric-paired)", () => {
    expect(isVizCompatible("downloads", "funnel")).toBe(false);
  });
  it("rejects stackedArea for avgRating", () => {
    expect(isVizCompatible("avgRating", "stackedArea")).toBe(false);
  });
  it("rejects heatmap for keywordRank", () => {
    expect(isVizCompatible("keywordRank", "heatmap")).toBe(false);
  });
});

describe("isBreakdownCompatible", () => {
  it("allows country for downloads", () => {
    expect(isBreakdownCompatible("downloads", "country")).toBe(true);
  });
  it("rejects source for downloads (sales has no bySource)", () => {
    expect(isBreakdownCompatible("downloads", "source")).toBe(false);
  });
  it("allows source for pageViews (analytics has bySource)", () => {
    expect(isBreakdownCompatible("pageViews", "source")).toBe(true);
  });
  it("always allows none", () => {
    expect(isBreakdownCompatible("avgRating", "none")).toBe(true);
  });
});

describe("vizForMetric", () => {
  it("returns the compatible viz list for downloads", () => {
    const v = vizForMetric("downloads");
    expect(v).toContain("area");
    expect(v).toContain("multiLine");
    expect(v).toContain("heatmap");
    expect(v).not.toContain("funnel");
  });
});
