import {
  salesPath, analyticsPath, ratingsPath, keywordsPath, reviewsPath,
  appMetaPath, configPath, insightsPath, runStatusPath,
  type AppMeta, type Config, type RunStatus, type Review,
  type AnalyticsDay, type KeywordRank,
} from "@/lib/store/paths";
import type { Store } from "@/lib/store/store";
import type { AppInput } from "@/lib/intelligence/engine";
import type { FunnelStage } from "@/lib/intelligence/funnel";

// Aggregate a contiguous slice of analytics days into one funnel stage. Rates are
// ratios, so summing a window is equivalent to averaging it.
function sumFunnel(rows: AnalyticsDay[]): FunnelStage {
  return rows.reduce<FunnelStage>(
    (acc, r) => ({
      impressions: acc.impressions + r.impressions,
      pageViews: acc.pageViews + r.pageViews,
      downloads: acc.downloads + r.downloads,
    }),
    { impressions: 0, pageViews: 0, downloads: 0 },
  );
}

// Build a real intelligence input from the freshly collected analytics + keywords.
// funnelToday = trailing 7 days, funnelBaseline = the 7 days before that ("this week
// vs last week"), which is stable for the low daily volumes these apps see.
function buildAppInput(
  app: AppMeta, analytics: AnalyticsDay[], keywords: KeywordRank[],
): AppInput {
  const sorted = [...analytics].sort((a, b) => a.day.localeCompare(b.day));
  const downloads = sorted.map((r) => ({ day: r.day, value: r.downloads }));
  const last14 = sorted.slice(-14);
  const funnelToday = sumFunnel(last14.slice(-7));
  const funnelBaseline = sumFunnel(last14.slice(0, Math.max(0, last14.length - 7)));
  return {
    appId: app.appId, name: app.name,
    downloads, funnelToday, funnelBaseline,
    keywords, releases: app.releases,
  };
}

export interface OrchestratorDeps {
  discoverApps: () => Promise<AppMeta[]>;
  collectSales: (apps: { appId: string; sku: string }[], day: string) => Promise<Record<string, any>>;
  collectAnalytics: (appId: string) => Promise<Record<string, any>>;
  collectReviews: (appId: string) => Promise<Review[]>;
  collectRatings: (appId: string, day: string) => Promise<any>;
  collectKeywords: (appId: string, day: string) => Promise<any[]>;
  runIntelligence: (args: { day: string; apps: AppInput[] }) => Promise<unknown>;
}

export async function runDailyCollection(input: {
  day: string; store: Store; deps: OrchestratorDeps;
}): Promise<RunStatus> {
  const { day, store, deps } = input;
  const apps = await deps.discoverApps();
  const config = await store.readJson<Config>(configPath(), { apps: {} });

  const status: RunStatus = {
    lastRun: new Date().toISOString(),
    lastSuccess: "",
    perApp: {},
  };
  let hadFailure = false;
  const mark = (
    id: string, k: string, ok: boolean,
    opts: { error?: string; rows?: number } = {},
  ) => {
    if (!ok) hadFailure = true;
    (status.perApp[id] ??= {})[k] = {
      ok, at: new Date().toISOString(),
      ...(opts.error ? { error: opts.error } : {}),
      ...(opts.rows !== undefined ? { rows: opts.rows } : {}),
    };
  };

  for (const a of apps) {
    const prev = await store.readJson<AppMeta | null>(appMetaPath(a.appId), null);
    const merged: AppMeta = prev ? { ...a, firstSeen: prev.firstSeen, hidden: prev.hidden, archived: prev.archived, releases: prev.releases } : a;
    await store.writeJson(appMetaPath(a.appId), merged, `chore(data): meta ${a.appId}`);
  }

  const appIds = apps.map((a) => a.appId);
  let salesByApp: Record<string, any> = {};
  try {
    salesByApp = await deps.collectSales(apps, day);
    appIds.forEach((id) => mark(id, "sales", true, { rows: salesByApp[id] ? 1 : 0 }));
  } catch (e: any) {
    appIds.forEach((id) => mark(id, "sales", false, { error: String(e?.message ?? e) }));
  }

  // Per-app work runs in parallel — each app writes to distinct paths so there's no
  // contention, and the GitHub Contents API handles concurrent commits. Serial loop
  // blew the 60s Hobby function cap once analytics started doing real CSV downloads.
  // Captured from the parallel pass so the intelligence input can be built from real
  // collected data instead of the zeroed placeholder it used before.
  const collected: Record<string, { analytics: AnalyticsDay[]; keywords: KeywordRank[] }> = {};

  const perApp = apps.map(async (a) => {
    const id = a.appId;
    collected[id] = { analytics: [], keywords: [] };
    // Sales rows carry a lagged report date (see cron route); file them under their own
    // day so a month-boundary lag lands in the correct month file.
    if (salesByApp[id]) {
      const sd = salesByApp[id].day ?? day;
      await store.upsertDailyArray(salesPath(id, sd), [salesByApp[id]], `data: sales ${id} ${sd}`);
    }

    let analyticsDays: Record<string, any> = {};
    try { analyticsDays = await deps.collectAnalytics(id); mark(id, "analytics", true, { rows: Object.keys(analyticsDays).length }); }
    catch (e: any) { mark(id, "analytics", false, { error: String(e?.message ?? e) }); }
    const aDays = Object.values(analyticsDays) as AnalyticsDay[];
    collected[id].analytics = aDays;
    if (aDays.length) await store.upsertDailyArray(analyticsPath(id, day), aDays as any[], `data: analytics ${id}`);

    let reviews: Review[] = [];
    try { reviews = await deps.collectReviews(id); mark(id, "reviews", true, { rows: reviews.length }); }
    catch (e: any) { mark(id, "reviews", false, { error: String(e?.message ?? e) }); }
    if (reviews.length) {
      const prevReviews = await store.readJson<Review[]>(reviewsPath(id), []);
      const map = new Map(prevReviews.map((r) => [r.id, r]));
      for (const r of reviews) map.set(r.id, r);
      await store.writeJson(reviewsPath(id), [...map.values()], `data: reviews ${id}`);
    }

    try { const rp = await deps.collectRatings(id, day); await store.upsertDailyArray(ratingsPath(id, day), [rp], `data: ratings ${id} ${day}`); mark(id, "ratings", true, { rows: 1 }); }
    catch (e: any) { mark(id, "ratings", false, { error: String(e?.message ?? e) }); }

    try {
      const watch = config.apps[id]?.keywords ?? [];
      const kr = await deps.collectKeywords(id, day);
      collected[id].keywords = kr as KeywordRank[];
      if (kr.length) await store.upsertDailyArray(keywordsPath(id, day), kr, `data: keywords ${id} ${day}`);
      void watch;
      mark(id, "keywords", true, { rows: kr.length });
    } catch (e: any) { mark(id, "keywords", false, { error: String(e?.message ?? e) }); }
  });
  await Promise.all(perApp);

  const intelInputs = apps.map((a) =>
    buildAppInput(a, collected[a.appId]?.analytics ?? [], collected[a.appId]?.keywords ?? []));

  try {
    const insights = await deps.runIntelligence({ day, apps: intelInputs });
    await store.writeJson(insightsPath(), insights, `data: insights ${day}`);
  } catch (e: any) {
    apps.forEach((a) => mark(a.appId, "intelligence", false, { error: String(e?.message ?? e) }));
  }

  status.lastSuccess = hadFailure ? "" : new Date().toISOString();
  await store.writeJson(runStatusPath(), status, `data: run-status ${day}`);
  return status;
}
