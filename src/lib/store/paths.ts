const month = (day: string) => day.slice(0, 7);

export const salesPath = (appId: string, day: string) => `data/${appId}/sales/${month(day)}.json`;
export const analyticsPath = (appId: string, day: string) => `data/${appId}/analytics/${month(day)}.json`;
export const ratingsPath = (appId: string, day: string) => `data/${appId}/ratings/${month(day)}.json`;
export const keywordsPath = (appId: string, day: string) => `data/${appId}/keywords/${month(day)}.json`;
export const reviewsPath = (appId: string) => `data/${appId}/reviews.json`;
export const admobPath = (day: string) => `data/admob/${month(day)}.json`;
export const appMetaPath = (appId: string) => `data/${appId}/meta.json`;
export const configPath = () => `data/config.json`;
export const insightsPath = () => `data/insights.json`;
export const dashboardsPath = () => `data/dashboards.json`;
export const runStatusPath = () => `data/run-status.json`;

export interface DailyMetric { day: string; [k: string]: string | number; }
// proceedsUsd is the LEGACY field: a raw sum of Apple's "Developer Proceeds" across mixed
// currencies (EUR/GBP/BRL/…) — misnamed and not actually USD. proceedsByCcy keeps the proceeds
// split by their reported "Currency of Proceeds"; proceedsEur is that map converted to EUR with
// ECB rates (see lib/fx.ts). Readers prefer proceedsEur and fall back to proceedsUsd for rows
// collected before the FX fix / backfill.
export interface SalesDay { day: string; byCountry: Record<string, number>; total: number; redownloads: number; proceedsUsd: number; proceedsByCcy?: Record<string, number>; proceedsEur?: number; }
export interface AnalyticsDay { day: string; impressions: number; pageViews: number; downloads: number; sessions: number; activeDevices: number; deletions: number; crashes: number; bySource: Record<string, number>; }
export interface RatingPoint { day: string; byCountry: Record<string, { avg: number; count: number }>; avg: number; count: number; }
export interface Review { id: string; rating: number; title: string; body: string; reviewer: string; territory: string; createdDate: string; responded: boolean; }
export interface KeywordRank { day: string; term: string; country: string; rank: number | null; }
export interface AppMeta { appId: string; name: string; bundleId: string; sku: string; firstSeen: string; hidden: boolean; archived: boolean; releases: { version: string; date: string }[]; }
export interface AppConfig { hidden: boolean; archived: boolean; keywords: { term: string; country: string }[]; goalDownloadsPerMonth?: number; }
export interface Config { apps: Record<string, AppConfig>; }
export interface RunStatus { lastRun: string; lastSuccess: string; perApp: Record<string, Record<string, { ok: boolean; at: string; error?: string; rows?: number }>>; }
