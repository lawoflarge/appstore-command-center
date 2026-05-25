// tests/lib/dashboards/schema.test.ts
import { describe, it, expect } from "vitest";
import { chartCardSchema, dashboardSliceSchema } from "@/lib/dashboards/schema";

const valid = {
  id: "abc", title: "T", metric: "downloads", viz: "area",
  appIds: "all", range: "30d", bucket: "day", breakdown: "none", compare: "none",
};

describe("chartCardSchema", () => {
  it("accepts a valid card", () => {
    expect(chartCardSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects an unknown metric", () => {
    expect(chartCardSchema.safeParse({ ...valid, metric: "wat" }).success).toBe(false);
  });
  it("rejects an unknown viz", () => {
    expect(chartCardSchema.safeParse({ ...valid, viz: "pie" }).success).toBe(false);
  });
  it("accepts an array of app ids", () => {
    expect(chartCardSchema.safeParse({ ...valid, appIds: ["1", "2"] }).success).toBe(true);
  });
});

describe("dashboardSliceSchema", () => {
  it("accepts a slice with one valid card", () => {
    const r = dashboardSliceSchema.safeParse({ cards: [valid], updatedAt: new Date().toISOString() });
    expect(r.success).toBe(true);
  });
});
