import type { Store } from "@/lib/store/store";
import { salesPath, analyticsPath, appMetaPath, insightsPath, ratingsPath, configPath, runStatusPath, type SalesDay, type AnalyticsDay, type AppMeta, type RatingPoint, type Config, type RunStatus } from "@/lib/store/paths";
import { rowsInMonth, monthsBetween } from "@/lib/dates";
import { totals, analyticsTotals } from "./downloads";

export async function buildGlance(store: Store, appIds: string[], month: string) {
  const insights = await store.readJson<any>(insightsPath(), { apps: {} });
  // Pass 1: load each visible app's current-month rows and find the SHARED latest day — the max
  // data day across ALL apps. A single global reference day is what keeps the summary, the per-app
  // list and the chart consistent: an app whose newest report is older than the reference day shows
  // N/A for it (see pass 2) instead of contributing a stale value mislabeled with a newer date.
  // Apple publishes analytics 24-48h late, so the reference day is "latest available", not today.
  type Loaded = { id: string; meta: AppMeta; analytics: AnalyticsDay[]; sales: SalesDay[]; ratings: RatingPoint[]; useAnalytics: boolean };
  const loaded: Loaded[] = [];
  let latestDay = "";
  for (const id of appIds) {
    const meta = await store.readJson<AppMeta | null>(appMetaPath(id), null);
    if (!meta || meta.hidden || meta.archived) continue;
    // Lifetime range: every month from the app's firstSeen to the current month, so "Total
    // downloads" is the real lifetime sum, not just the current month file. Each file is filtered
    // to its own month (drops cross-month spillover from Apple's rolling window) so a day is
    // canonical to one file. The cap in monthsBetween guards a missing/garbage firstSeen.
    const months = monthsBetween((meta.firstSeen || `${month}-01`).slice(0, 7), month);
    const [analyticsByMonth, salesByMonth] = await Promise.all([
      Promise.all(months.map((m) => store.readJson<AnalyticsDay[]>(analyticsPath(id, `${m}-01`), []))),
      Promise.all(months.map((m) => store.readJson<SalesDay[]>(salesPath(id, `${m}-01`), []))),
    ]);
    const analytics = analyticsByMonth.flatMap((rows, i) => rowsInMonth(rows, `${months[i]}-01`));
    const sales = salesByMonth.flatMap((rows, i) => rowsInMonth(rows, `${months[i]}-01`));
    const ratings = await store.readJson<RatingPoint[]>(ratingsPath(id, month + "-01"), []);
    // Prefer analytics — it matches ASC "Analytics → Overview". Sales TSV is the finance report;
    // for free apps it's commonly empty and always lags ~24h.
    const useAnalytics = analytics.length > 0;
    // Robust max over the actual rows — don't assume the on-disk array is sorted ascending.
    for (const r of useAnalytics ? analytics : sales) if (r.day > latestDay) latestDay = r.day;
    loaded.push({ id, meta, analytics, sales, ratings, useAnalytics });
  }
  // Pass 2: per app, the value AT the shared latest day. `today` is null when the app has no row
  // for it yet (cron/Apple hasn't published it for that app) → the UI renders "N/A".
  const apps = [];
  let ratingWeighted = 0;
  let ratingCount = 0;
  for (const { id, meta, analytics, sales, ratings, useAnalytics } of loaded) {
    const t = useAnalytics ? analyticsTotals(analytics, latestDay) : totals(sales, latestDay);
    const lastRating = ratings.at(-1) ?? null;
    if (lastRating && lastRating.count > 0) {
      ratingWeighted += lastRating.avg * lastRating.count;
      ratingCount += lastRating.count;
    }
    apps.push({
      appId: id,
      name: meta.name,
      ...t,
      rating: lastRating ? { avg: lastRating.avg, count: lastRating.count } : null,
      anomaly: insights.apps?.[id]?.anomaly ?? null,
    });
  }
  return { apps, blendedRating: { avg: ratingCount ? ratingWeighted / ratingCount : 0, count: ratingCount }, latestDay };
}

/**
 * Default visibility = "all discovered, none hidden". Discovered apps come from
 * run-status (every cron writes it). Config is an overlay for hide/archive/keywords;
 * an empty config no longer means "no apps", which was the source of the spurious
 * "No data yet" state on first deploy.
 */
export async function visibleAppIds(store: Store): Promise<string[]> {
  const cfg = await store.readJson<Config>(configPath(), { apps: {} });
  const status = await store.readJson<RunStatus | null>(runStatusPath(), null);
  const discovered = status ? Object.keys(status.perApp) : [];
  return discovered.filter((id) => {
    const c = cfg.apps[id];
    return !c || (!c.hidden && !c.archived);
  });
}
