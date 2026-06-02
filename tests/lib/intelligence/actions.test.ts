import { test, expect } from "vitest";
import { buildActionItems } from "@/lib/intelligence/actions";
import type { Insights } from "@/lib/intelligence/engine";

function emptyFunnel() {
  return {
    leak: "none" as const,
    message: "Funnel within normal range.",
    rates: { ipv: 0.3, pvd: 0.1, baselineIpv: 0.3, baselinePvd: 0.1 },
  };
}
function emptyForecast() {
  return { soFar: 0, projected: 0, band: { low: 0, high: 0 } };
}

test("empty insights yields no items", () => {
  const insights: Insights = { generatedAt: "2026-06-01", apps: {} };
  expect(buildActionItems(insights)).toEqual([]);
});

test("drop anomaly becomes a critical item with a release-aware recommendation", () => {
  const insights: Insights = {
    generatedAt: "2026-06-01",
    apps: {
      "1": {
        name: "Alpha",
        anomaly: { appId: "1", metric: "downloads", day: "2026-06-01", direction: "drop", z: -3.2, value: 10, baseline: 100, cause: "Near the 1.4 release (2026-05-31)", nearRelease: true },
        funnel: emptyFunnel(),
        opportunities: [],
        forecast: emptyForecast(),
      },
    },
  };
  const items = buildActionItems(insights);
  expect(items).toHaveLength(1);
  expect(items[0].kind).toBe("anomaly_drop");
  expect(items[0].severity).toBe("critical");
  expect(items[0].appName).toBe("Alpha");
  expect(items[0].recommendation).toContain("release");
});

test("funnel pvd leak outranks a keyword opportunity which outranks a spike", () => {
  const insights: Insights = {
    generatedAt: "2026-06-01",
    apps: {
      "spike": {
        name: "Spiker",
        anomaly: { appId: "spike", metric: "downloads", day: "2026-06-01", direction: "spike", z: 3.0, value: 200, baseline: 100, cause: "Unusual positive movement — check press/feature/ASA", nearRelease: false },
        funnel: emptyFunnel(), opportunities: [], forecast: emptyForecast(),
      },
      "leak": {
        name: "Leaker", anomaly: null,
        funnel: { leak: "pageView_to_install", message: "Page-view->install fell.", rates: { ipv: 0.3, pvd: 0.05, baselineIpv: 0.3, baselinePvd: 0.1 } },
        opportunities: [], forecast: emptyForecast(),
      },
      "kw": {
        name: "Worder", anomaly: null, funnel: emptyFunnel(),
        opportunities: [{ term: "diet", country: "us", rank: 9, trend: "declining" }],
        forecast: emptyForecast(),
      },
    },
  };
  const items = buildActionItems(insights);
  expect(items.map((i) => i.kind)).toEqual(["funnel_pvd", "keyword_declining", "anomaly_spike"]);
  expect(items[0].severity).toBe("critical");
  expect(items[1].severity).toBe("opportunity");
  expect(items[2].severity).toBe("good");
});

test("keyword items are capped at 3 per app, highest-ranked first", () => {
  const insights: Insights = {
    generatedAt: "2026-06-01",
    apps: {
      "1": {
        name: "Many", anomaly: null, funnel: emptyFunnel(), forecast: emptyForecast(),
        opportunities: [
          { term: "a", country: "us", rank: 25, trend: "declining" },
          { term: "b", country: "us", rank: 20, trend: "declining" },
          { term: "c", country: "us", rank: 15, trend: "declining" },
          { term: "d", country: "us", rank: 9, trend: "declining" },
        ],
      },
    },
  };
  const items = buildActionItems(insights);
  expect(items).toHaveLength(3);
  expect(items.map((i) => i.detail).every((d) => typeof d === "string")).toBe(true);
  expect(items[0].detail).toContain("#9");
});

test("drop anomaly with no nearby release produces availability/seasonality recommendation", () => {
  const insights: Insights = {
    generatedAt: "2026-06-01",
    apps: {
      "2": {
        name: "Beta",
        anomaly: { appId: "2", metric: "downloads", day: "2026-06-01", direction: "drop", z: -3.5, value: 5, baseline: 80, cause: "No release nearby — check storefront availability / external event", nearRelease: false },
        funnel: emptyFunnel(),
        opportunities: [],
        forecast: emptyForecast(),
      },
    },
  };
  const items = buildActionItems(insights);
  expect(items).toHaveLength(1);
  expect(items[0].kind).toBe("anomaly_drop");
  expect(items[0].recommendation).toContain("availability");
});

test("flat keyword trends are not surfaced", () => {
  const insights: Insights = {
    generatedAt: "2026-06-01",
    apps: {
      "1": {
        name: "Flat", anomaly: null, funnel: emptyFunnel(), forecast: emptyForecast(),
        opportunities: [{ term: "x", country: "us", rank: 12, trend: "flat" }],
      },
    },
  };
  expect(buildActionItems(insights)).toEqual([]);
});
