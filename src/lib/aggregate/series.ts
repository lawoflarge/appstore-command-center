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
    if (metric === "proceedsUsd") return r.proceedsEur ?? r.proceedsUsd;
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
  // `downloads` lives in BOTH sources: analytics ("App Units", matches ASC Overview) and
  // the finance sales TSV. For free apps the sales TSV is empty and lags ~24h, so downloads
  // is resolved with an analytics-first fallback in appDayMap, not here.
  if (metric === "downloads") return "analytics";
  if (["redownloads", "proceedsUsd"].includes(metric)) return "sales";
  if (["impressions", "pageViews", "sessions", "activeDevices", "deletions", "crashes"].includes(metric)) return "analytics";
  if (["avgRating", "ratingsCount"].includes(metric)) return "ratings";
  if (["reviewCount", "responseRate"].includes(metric)) return "reviews";
  if (metric === "keywordRank") return "keywords";
  return "derived";
}

function appDayMap(card: ChartCard, appId: string, raw: RawBundle): Map<string, number> {
  const src = sourceFor(card.metric);
  const out = new Map<string, number>();
  // Downloads: analytics is the source of truth (matches ASC Overview); fall back to the
  // finance sales TSV only when analytics has no rows for this app.
  if (card.metric === "downloads") {
    const analytics = raw.analytics[appId] ?? [];
    if (analytics.length) {
      for (const r of analytics) out.set(r.day, r.downloads);
    } else {
      for (const r of raw.sales[appId] ?? []) out.set(r.day, r.total);
    }
    return out;
  }
  if (src === "sales") {
    for (const r of raw.sales[appId] ?? []) out.set(r.day, metricValueFromRow(card.metric, "sales", r));
  } else if (src === "analytics") {
    for (const r of raw.analytics[appId] ?? []) out.set(r.day, metricValueFromRow(card.metric, "analytics", r));
  } else if (src === "ratings") {
    for (const r of raw.ratings[appId] ?? []) out.set(r.day, metricValueFromRow(card.metric, "ratings", r));
  } else if (src === "derived") {
    for (const r of raw.analytics[appId] ?? []) {
      const num = card.metric === "convPageToInstall" ? r.downloads : r.pageViews;
      const den = card.metric === "convPageToInstall" ? r.pageViews  : r.impressions;
      if (den > 0) out.set(r.day, num / den);
    }
  } else if (src === "reviews") {
    if (card.metric === "reviewCount") {
      for (const rv of raw.reviews[appId] ?? []) {
        const day = rv.createdDate.slice(0, 10);
        out.set(day, (out.get(day) ?? 0) + 1);
      }
    } else if (card.metric === "responseRate") {
      const counts = new Map<string, number>();
      const responded = new Map<string, number>();
      for (const rv of raw.reviews[appId] ?? []) {
        const day = rv.createdDate.slice(0, 10);
        counts.set(day, (counts.get(day) ?? 0) + 1);
        if (rv.responded) responded.set(day, (responded.get(day) ?? 0) + 1);
      }
      for (const [day, total] of counts) out.set(day, (responded.get(day) ?? 0) / total);
    }
  } else if (src === "keywords") {
    for (const r of raw.keywords[appId] ?? []) {
      if (card.keywordTerm && r.term !== card.keywordTerm) continue;
      if (r.rank != null) out.set(r.day, r.rank);
    }
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

function breakdownByApp(card: ChartCard, raw: RawBundle): { key: string; label: string; points: Point[] }[] {
  const apps = appIdsFor(card, raw);
  const window = rangeWindow(card.range, raw.today);
  return apps.map((appId) => {
    const dayMap = appDayMap(card, appId, raw);
    const points = [...dayMap.entries()]
      .filter(([day]) => inWindow(day, window))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, value]) => ({ day, value }));
    return { key: appId, label: raw.apps[appId]?.name ?? appId, points };
  }).filter((s) => s.points.length > 0);
}

function breakdownByCountry(card: ChartCard, raw: RawBundle): { key: string; label: string; points: Point[] }[] {
  const apps = appIdsFor(card, raw);
  const window = rangeWindow(card.range, raw.today);
  const perCountry = new Map<string, Map<string, number>>();
  for (const appId of apps) {
    for (const r of raw.sales[appId] ?? []) {
      if (!inWindow(r.day, window)) continue;
      for (const [country, v] of Object.entries(r.byCountry)) {
        if (!perCountry.has(country)) perCountry.set(country, new Map());
        const m = perCountry.get(country)!;
        m.set(r.day, (m.get(r.day) ?? 0) + v);
      }
    }
  }
  return [...perCountry.entries()].map(([country, m]) => ({
    key: country, label: country,
    points: [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, value })),
  }));
}

function breakdownBySource(card: ChartCard, raw: RawBundle): { key: string; label: string; points: Point[] }[] {
  const apps = appIdsFor(card, raw);
  const window = rangeWindow(card.range, raw.today);
  const perSource = new Map<string, Map<string, number>>();
  for (const appId of apps) {
    for (const r of raw.analytics[appId] ?? []) {
      if (!inWindow(r.day, window)) continue;
      for (const [source, v] of Object.entries(r.bySource)) {
        if (!perSource.has(source)) perSource.set(source, new Map());
        const m = perSource.get(source)!;
        m.set(r.day, (m.get(r.day) ?? 0) + v);
      }
    }
  }
  return [...perSource.entries()].map(([source, m]) => ({
    key: source, label: source,
    points: [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, value })),
  }));
}

function multiSeries(card: ChartCard, raw: RawBundle): { key: string; label: string; points: Point[] }[] {
  if (card.viz === "smallMultiples") return breakdownByApp({ ...card, appIds: "all" }, raw);
  if (card.breakdown === "country") return breakdownByCountry(card, raw);
  if (card.breakdown === "source")  return breakdownBySource(card, raw);
  return breakdownByApp(card, raw);
}

function funnelStages(card: ChartCard, raw: RawBundle): { label: string; value: number; rate?: number }[] {
  const apps = appIdsFor(card, raw);
  const window = rangeWindow(card.range, raw.today);
  let impressions = 0, pageViews = 0, downloads = 0;
  for (const appId of apps) {
    for (const r of raw.analytics[appId] ?? []) {
      if (!inWindow(r.day, window)) continue;
      impressions += r.impressions;
      pageViews   += r.pageViews;
      downloads   += r.downloads;
    }
  }
  const rate = (a: number, b: number) => (b > 0 ? a / b : undefined);
  // Impressions → Page views → Downloads. The intermediate "Sessions" stage was removed:
  // sessions aren't part of the acquisition funnel and dividing downloads by sessions (often
  // 0) collapsed the install rate to "—". This matches diagnoseFunnel() in intelligence/funnel.
  return [
    { label: "Impressions", value: impressions },
    { label: "Page views",  value: pageViews,  rate: rate(pageViews, impressions) },
    { label: "Downloads",   value: downloads,  rate: rate(downloads, pageViews) },
  ];
}

function previousPeriodSeries(card: ChartCard, raw: RawBundle): Point[] {
  const cur = rangeWindow(card.range, raw.today);
  const from = new Date(cur.from + "T00:00:00Z");
  const to   = new Date(cur.to   + "T00:00:00Z");
  const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(from.getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * 86_400_000);
  const shifted: ChartCard = { ...card, range: "all", compare: "none" };
  const all = summedDailySeries(shifted, { ...raw, today: prevTo.toISOString().slice(0, 10) });
  const fromIso = prevFrom.toISOString().slice(0, 10);
  const prevToIso = prevTo.toISOString().slice(0, 10);
  return all
    .filter((p) => p.day >= fromIso && p.day <= prevToIso)
    .map((p) => {
      const d = new Date(p.day + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + spanDays);
      return { day: d.toISOString().slice(0, 10), value: p.value };
    });
}

export function buildSeries(card: ChartCard, raw: RawBundle): SeriesData {
  if (card.viz === "area" || card.viz === "bar" || card.viz === "heatmap") {
    const points = summedDailySeries(card, raw);
    if (card.viz !== "heatmap" && card.compare === "prevPeriod") {
      const compare = previousPeriodSeries(card, raw);
      return { kind: card.viz, points, compare };
    }
    return { kind: card.viz, points };
  }
  if (card.viz === "multiLine" || card.viz === "stackedArea" || card.viz === "smallMultiples") {
    return { kind: card.viz, series: multiSeries(card, raw) };
  }
  if (card.viz === "funnel") return { kind: "funnel", stages: funnelStages(card, raw) };
  throw new Error(`unknown viz "${card.viz}"`);
}
