// src/lib/dashboards/types.ts

export type Metric =
  | "downloads" | "redownloads" | "proceedsUsd"
  | "impressions" | "pageViews" | "sessions"
  | "activeDevices" | "deletions" | "crashes"
  | "convPageToInstall" | "convImpressionToPage"
  | "avgRating" | "ratingsCount"
  | "reviewCount" | "responseRate"
  | "keywordRank";

export type Viz =
  | "area" | "multiLine" | "stackedArea" | "bar"
  | "funnel" | "smallMultiples" | "heatmap";

export type Range = "7d" | "30d" | "90d" | "mtd" | "ytd" | "all";
export type Bucket = "day" | "week" | "month";
export type Breakdown = "none" | "country" | "source" | "app";
export type Compare = "none" | "prevPeriod";

export interface ChartCard {
  id: string;
  title: string;
  metric: Metric;
  viz: Viz;
  appIds: "all" | string[];
  range: Range;
  bucket: Bucket;
  breakdown: Breakdown;
  compare: Compare;
  keywordTerm?: string;
}

export interface DashboardSlice {
  cards: ChartCard[];
  updatedAt: string; // ISO 8601 UTC
}

export interface DashboardsFile {
  byId: Record<string, DashboardSlice>; // keys: "glance" | "app:<appId>"
}

export interface Point { day: string; value: number }

export type SeriesData =
  | { kind: "area"; points: Point[]; compare?: Point[] }
  | { kind: "bar"; points: Point[]; compare?: Point[] }
  | { kind: "heatmap"; points: Point[] }
  | { kind: "multiLine"; series: { key: string; label: string; points: Point[] }[] }
  | { kind: "stackedArea"; series: { key: string; label: string; points: Point[] }[] }
  | { kind: "smallMultiples"; series: { key: string; label: string; points: Point[] }[] }
  | { kind: "funnel"; stages: { label: string; value: number; rate?: number }[] };
