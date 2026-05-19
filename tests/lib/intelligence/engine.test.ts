import { test, expect } from "vitest";
import { runIntelligence } from "@/lib/intelligence/engine";

test("runIntelligence aggregates anomalies + opportunities + forecast per app", async () => {
  const insights = await runIntelligence({
    day: "2026-05-18",
    apps: [{
      appId: "1", name: "A",
      downloads: [
        { day: "2026-04-20", value: 100 }, { day: "2026-04-27", value: 100 },
        { day: "2026-05-04", value: 100 }, { day: "2026-05-11", value: 100 },
        { day: "2026-05-18", value: 10 },
      ],
      funnelToday: { impressions: 1000, pageViews: 300, downloads: 30 },
      funnelBaseline: { impressions: 1000, pageViews: 300, downloads: 90 },
      keywords: [{ day: "2026-05-18", term: "k", country: "de", rank: 10 }],
      releases: [],
    }],
  });
  const a = insights.apps["1"];
  expect(a.anomaly?.direction).toBe("drop");
  expect(a.funnel.leak).toBe("pageView_to_install");
  expect(a.opportunities[0].term).toBe("k");
  expect(a.forecast.projected).toBeGreaterThan(0);
  expect(insights.generatedAt).toBe("2026-05-18");
});
