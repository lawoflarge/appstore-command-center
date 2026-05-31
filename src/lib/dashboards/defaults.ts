// src/lib/dashboards/defaults.ts
import type { ChartCard, DashboardSlice } from "./types";

let counter = 0;
const id = () => `default-${++counter}-${Math.random().toString(36).slice(2, 10)}`;

function glanceCards(): ChartCard[] {
  return [
    { id: id(), title: "Total downloads", metric: "downloads", viz: "multiLine",
      appIds: "all", range: "30d", bucket: "day", breakdown: "app", compare: "none" },
    { id: id(), title: "Acquisition funnel", metric: "downloads", viz: "funnel",
      appIds: "all", range: "30d", bucket: "day", breakdown: "none", compare: "none" },
    { id: id(), title: "Downloads by source", metric: "downloads", viz: "stackedArea",
      appIds: "all", range: "90d", bucket: "day", breakdown: "source", compare: "none" },
    { id: id(), title: "Avg rating", metric: "avgRating", viz: "multiLine",
      appIds: "all", range: "90d", bucket: "day", breakdown: "app", compare: "none" },
  ];
}

function perAppCards(appId: string): ChartCard[] {
  return [
    { id: id(), title: "Downloads", metric: "downloads", viz: "area",
      appIds: [appId], range: "30d", bucket: "day", breakdown: "none", compare: "prevPeriod" },
    { id: id(), title: "Conversion funnel", metric: "downloads", viz: "funnel",
      appIds: [appId], range: "30d", bucket: "day", breakdown: "none", compare: "none" },
    { id: id(), title: "Traffic by source", metric: "pageViews", viz: "stackedArea",
      appIds: [appId], range: "30d", bucket: "day", breakdown: "source", compare: "none" },
    { id: id(), title: "Activity heatmap", metric: "downloads", viz: "heatmap",
      appIds: [appId], range: "90d", bucket: "day", breakdown: "none", compare: "none" },
  ];
}

export function defaultsFor(dashboardId: string): DashboardSlice {
  const cards = dashboardId === "glance"
    ? glanceCards()
    : perAppCards(dashboardId.replace(/^app:/, ""));
  return { cards, updatedAt: new Date(0).toISOString() };
}
