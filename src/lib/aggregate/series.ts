// src/lib/aggregate/series.ts
import type { ChartCard, Metric, SeriesData, Point } from "@/lib/dashboards/types";
import type {
  SalesDay, AnalyticsDay, RatingPoint, Review, KeywordRank, AppMeta,
} from "@/lib/store/paths";

export interface RawBundle {
  apps: Record<string, Pick<AppMeta, "name">>;
  sales:     Record<string, SalesDay[]>;
  analytics: Record<string, AnalyticsDay[]>;
  ratings:   Record<string, RatingPoint[]>;
  reviews:   Record<string, Review[]>;
  keywords:  Record<string, KeywordRank[]>;
  today: string; // YYYY-MM-DD, UTC
}

function rangeWindow(range: ChartCard["range"], today: string): { from: string; to: string } {
  if (range === "all") return { from: "0000-01-01", to: today };
  const to = today;
  const t = new Date(today + "T00:00:00Z");
  if (range === "mtd") return { from: today.slice(0, 8) + "01", to };
  if (range === "ytd") return { from: today.slice(0, 4) + "-01-01", to };
  const days = range === "7d" ? 6 : range === "30d" ? 29 : 89;
  t.setUTCDate(t.getUTCDate() - days);
  return { from: t.toISOString().slice(0, 10), to };
}

function inWindow(day: string, w: { from: string; to: string }): boolean {
  return day >= w.from && day <= w.to;
}

function appIdsFor(card: ChartCard, raw: RawBundle): string[] {
  return card.appIds === "all" ? Object.keys(raw.apps) : card.appIds;
}

function metricValueFromRow(
  metric: Metric, src: "sales" | "analytics" | "ratings",
  row: SalesDay | AnalyticsDay | RatingPoint,
): number {
  if (src === "sales") {
    const r = row as SalesDay;
    if (metric === "downloads") return r.total;
    if (metric === "redownloads") return r.redownloads;
    if (metric === "proceedsUsd") return r.proceedsUsd;
  }
  if (src === "analytics") {
    const r = row as AnalyticsDay;
    if (metric === "downloads") return r.downloads;
    if (metric === "impressions") return r.impressions;
    if (metric === "pageViews") return r.pageViews;
    if (metric === "sessions") return r.sessions;
    if (metric === "activeDevices") return r.activeDevices;
    if (metric === "deletions") return r.deletions;
    if (metric === "crashes") return r.crashes;
  }
  if (src === "ratings") {
    const r = row as RatingPoint;
    if (metric === "avgRating") return r.avg;
    if (metric === "ratingsCount") return r.count;
  }
  return 0;
}

function sourceFor(metric: Metric): "sales" | "analytics" | "ratings" | "reviews" | "keywords" | "derived" {
  if (["downloads", "redownloads", "proceedsUsd"].includes(metric)) return "sales";
  if (["impressions", "pageViews", "sessions", "activeDevices", "deletions", "crashes"].includes(metric)) return "analytics";
  if (["avgRating", "ratingsCount"].includes(metric)) return "ratings";
  if (["reviewCount", "responseRate"].includes(metric)) return "reviews";
  if (metric === "keywordRank") return "keywords";
  return "derived";
}

function appDayMap(card: ChartCard, appId: string, raw: RawBundle): Map<string, number> {
  const src = sourceFor(card.metric);
  const out = new Map<string, number>();
  if (src === "sales") {
    for (const r of raw.sales[appId] ?? []) out.set(r.day, metricValueFromRow(card.metric, "sales", r));
  } else if (src === "analytics") {
    for (const r of raw.analytics[appId] ?? []) out.set(r.day, metricValueFromRow(card.metric, "analytics", r));
  } else if (src === "ratings") {
    for (const r of raw.ratings[appId] ?? []) out.set(r.day, metricValueFromRow(card.metric, "ratings", r));
  }
  return out;
}

function summedDailySeries(card: ChartCard, raw: RawBundle): Point[] {
  const apps = appIdsFor(card, raw);
  const window = rangeWindow(card.range, raw.today);
  const merged = new Map<string, number>();
  for (const appId of apps) {
    for (const [day, val] of appDayMap(card, appId, raw)) {
      if (!inWindow(day, window)) continue;
      merged.set(day, (merged.get(day) ?? 0) + val);
    }
  }
  return [...merged.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, value]) => ({ day, value }));
}

export function buildSeries(card: ChartCard, raw: RawBundle): SeriesData {
  if (card.viz === "area" || card.viz === "bar" || card.viz === "heatmap") {
    const points = summedDailySeries(card, raw);
    return { kind: card.viz, points };
  }
  throw new Error(`viz "${card.viz}" not yet implemented`);
}
