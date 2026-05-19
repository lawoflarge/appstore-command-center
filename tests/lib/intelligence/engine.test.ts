import { test, expect, vi } from "vitest";
import { runIntelligence } from "@/lib/intelligence/engine";

test("runIntelligence aggregates anomalies + opportunities + forecast per app", async () => {
  const flat = (v: number) => ["2026-04-20","2026-04-27","2026-05-04","2026-05-11","2026-05-18"].map((day) => ({ day, value: v }));
  const insights = await runIntelligence({
    day: "2026-05-18",
    apps: [{
      appId: "1", name: "A",
      downloads: [...flat(100).slice(0,4), { day: "2026-05-18", value: 10 }],
      funnelToday: { impressions: 1000, pageViews: 300, downloads: 30 },
      funnelBaseline: { impressions: 1000, pageViews: 300, downloads: 90 },
      keywords: [{ day: "2026-05-18", term: "k", country: "de", rank: 10 }],
      releases: [],
      newReviews: [],
    }],
    llm: { complete: vi.fn(async () => '{"themes":[]}') } as any,
  });
  const a = insights.apps["1"];
  expect(a.anomaly?.direction).toBe("drop");
  expect(a.funnel.leak).toBe("pageView_to_install");
  expect(a.opportunities[0].term).toBe("k");
  expect(a.forecast.projected).toBeGreaterThan(0);
  expect(insights.generatedAt).toBe("2026-05-18");
});
