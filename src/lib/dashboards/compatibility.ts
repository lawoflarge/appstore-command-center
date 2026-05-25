// src/lib/dashboards/compatibility.ts
import type { Metric, Viz, Breakdown } from "./types";

type MetricClass = "sales" | "analytics" | "derived" | "ratings" | "reviews" | "keywords";

const METRIC_CLASS: Record<Metric, MetricClass> = {
  downloads: "sales", redownloads: "sales", proceedsUsd: "sales",
  impressions: "analytics", pageViews: "analytics", sessions: "analytics",
  activeDevices: "analytics", deletions: "analytics", crashes: "analytics",
  convPageToInstall: "derived", convImpressionToPage: "derived",
  avgRating: "ratings", ratingsCount: "ratings",
  reviewCount: "reviews", responseRate: "reviews",
  keywordRank: "keywords",
};

// `funnel` is excluded from every metric's list — UI offers funnel as a
// standalone viz that sums analytics-funnel stages across apps.
const VIZ_BY_CLASS: Record<MetricClass, Viz[]> = {
  sales:     ["area", "multiLine", "stackedArea", "bar", "smallMultiples", "heatmap"],
  analytics: ["area", "multiLine", "stackedArea", "bar", "smallMultiples", "heatmap"],
  derived:   ["area", "multiLine", "smallMultiples"],
  ratings:   ["area", "multiLine", "smallMultiples"],
  reviews:   ["area", "multiLine", "bar", "smallMultiples"],
  keywords:  ["area", "multiLine"],
};

const BREAKDOWN_BY_CLASS: Record<MetricClass, Breakdown[]> = {
  sales:     ["none", "country", "app"],
  analytics: ["none", "source", "app"],
  derived:   ["none", "app"],
  ratings:   ["none", "country", "app"],
  reviews:   ["none", "app"],
  keywords:  ["none", "app"],
};

export function isVizCompatible(metric: Metric, viz: Viz): boolean {
  return VIZ_BY_CLASS[METRIC_CLASS[metric]].includes(viz);
}

export function isBreakdownCompatible(metric: Metric, breakdown: Breakdown): boolean {
  return BREAKDOWN_BY_CLASS[METRIC_CLASS[metric]].includes(breakdown);
}

export function vizForMetric(metric: Metric): Viz[] {
  return [...VIZ_BY_CLASS[METRIC_CLASS[metric]]];
}

export function breakdownForMetric(metric: Metric): Breakdown[] {
  return [...BREAKDOWN_BY_CLASS[METRIC_CLASS[metric]]];
}
