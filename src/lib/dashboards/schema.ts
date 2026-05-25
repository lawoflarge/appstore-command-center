// src/lib/dashboards/schema.ts
import { z } from "zod";

export const metricSchema = z.enum([
  "downloads", "redownloads", "proceedsUsd",
  "impressions", "pageViews", "sessions",
  "activeDevices", "deletions", "crashes",
  "convPageToInstall", "convImpressionToPage",
  "avgRating", "ratingsCount",
  "reviewCount", "responseRate",
  "keywordRank",
]);

export const vizSchema = z.enum([
  "area", "multiLine", "stackedArea", "bar",
  "funnel", "smallMultiples", "heatmap",
]);

export const chartCardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  metric: metricSchema,
  viz: vizSchema,
  appIds: z.union([z.literal("all"), z.array(z.string().min(1))]),
  range: z.enum(["7d", "30d", "90d", "mtd", "ytd", "all"]),
  bucket: z.enum(["day", "week", "month"]),
  breakdown: z.enum(["none", "country", "source", "app"]),
  compare: z.enum(["none", "prevPeriod"]),
  keywordTerm: z.string().optional(),
});

export const dashboardSliceSchema = z.object({
  cards: z.array(chartCardSchema).max(40),
  updatedAt: z.string(),
});
