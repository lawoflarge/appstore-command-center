// tests/lib/dashboards/defaults.test.ts
import { describe, it, expect } from "vitest";
import { defaultsFor } from "@/lib/dashboards/defaults";

describe("defaultsFor", () => {
  it("glance returns 4 cards including a funnel and a multi-line", () => {
    const slice = defaultsFor("glance");
    expect(slice.cards).toHaveLength(4);
    const vizCounts = slice.cards.map((c) => c.viz).sort();
    expect(vizCounts).toEqual(["funnel", "multiLine", "multiLine", "stackedArea"]);
    expect(slice.cards.find((c) => c.metric === "downloads")?.breakdown).toBe("app");
  });

  it("per-app returns 4 cards with the app id pinned", () => {
    const slice = defaultsFor("app:1234");
    expect(slice.cards).toHaveLength(4);
    for (const c of slice.cards) {
      expect(c.appIds).toEqual(["1234"]);
    }
    expect(slice.cards.find((c) => c.viz === "heatmap")?.metric).toBe("downloads");
  });

  it("ids are unique within a slice", () => {
    const slice = defaultsFor("glance");
    const ids = new Set(slice.cards.map((c) => c.id));
    expect(ids.size).toBe(slice.cards.length);
  });
});
