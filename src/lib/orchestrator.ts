import {
  salesPath, analyticsPath, ratingsPath, keywordsPath, reviewsPath,
  appMetaPath, configPath, insightsPath, runStatusPath,
  type AppMeta, type Config, type RunStatus, type Review,
  type AnalyticsDay, type KeywordRank,
} from "@/lib/store/paths";
import type { Store } from "@/lib/store/store";
import type { AppInput } from "@/lib/intelligence/engine";
import type { FunnelStage } from "@/lib/intelligence/funnel";
import { rowsInMonth } from "@/lib/dates";

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

// Apple's ONGOING analytics report is a rolling window: a date ages out after ~16 days and the
// report then reports it as 0 (or only as a non-download row), which a plain newest-wins merge
// would write straight over the real, previously-collected count — silently zeroing each app's
// oldest day, one per day, and undercounting lifetime downloads (NetGuard lost Jun-1=13 + Jun-2=35).
// Treat an incoming 0 as "no data for this aged day", not a revision: keep the recorded positive.
// A genuine non-zero revision (estimates settling) is still honored.
export function mergeAnalyticsDay(prev: AnalyticsDay, inc: AnalyticsDay): AnalyticsDay {
  return {
    ...inc,
    downloads: inc.downloads > 0 ? inc.downloads : prev.downloads,
    impressions: inc.impressions > 0 ? inc.impressions : prev.impressions,
    pageViews: inc.pageViews > 0 ? inc.pageViews : prev.pageViews,
    bySource: inc.downloads > 0 ? inc.bySource : prev.bySource,
  };
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

// The current month start and the previous one, as YYYY-MM-01 — enough history for the
// trailing-14-day download series + this-week-vs-last-week funnel even right after a month
// boundary, without fanning out into many file reads.
function recentMonthStarts(day: string): string[] {
  const cur = day.slice(0, 7) + "-01";
  const d = new Date(day + "T00:00:00.000Z");
  d.setUTCMonth(d.getUTCMonth() - 1);
  return [d.toISOString().slice(0, 7) + "-01", cur];
}

// Build intelligence inputs for EVERY app from the persisted store rather than from the
// in-memory data collected this run. A cron round-robin batch or a refresh batch only
// touches a subset of apps, but insights must still cover the whole portfolio — reading
// each app's freshly-written analytics + keywords back from the store makes a partial run
// and a full run converge on the same result. Each month file is filtered to its own month
// (rolling-window days can spill across the boundary) so a day is never double-counted.
async function buildIntelInputsFromStore(
  store: Store, apps: AppMeta[], day: string,
): Promise<AppInput[]> {
  const months = recentMonthStarts(day);
  return Promise.all(apps.map(async (a) => {
    const files = await Promise.all(
      months.map((m) => store.readJson<AnalyticsDay[]>(analyticsPath(a.appId, m), [])));
    const analytics = files.flatMap((rows, i) => rowsInMonth(rows, months[i]));
    const keywords = await store.readJson<KeywordRank[]>(keywordsPath(a.appId, day), []);
    return buildAppInput(a, analytics, keywords);
  }));
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
  /** Restrict per-app collection to these ids (cron round-robin batch / refresh batch).
   *  Omit to collect every discovered app. An empty array collects no per-app data —
   *  used by the refresh "finish" call that only runs intelligence + status. */
  appIds?: string[];
  /** Run the intelligence pass + finalize run-status health. Default true. The refresh's
   *  per-app batches pass false; one final call passes true. */
  intelligence?: boolean;
}): Promise<RunStatus> {
  const { day, store, deps } = input;
  const runIntel = input.intelligence ?? true;
  const allApps = await deps.discoverApps();
  const apps = input.appIds
    ? allApps.filter((a) => input.appIds!.includes(a.appId))
    : allApps;
  const config = await store.readJson<Config>(configPath(), { apps: {} });

  const status: RunStatus = {
    lastRun: new Date().toISOString(),
    lastSuccess: "",
    perApp: {},
  };
  let hadFailure = false;
  // Cap recorded errors: run-status.json is read through the GitHub Contents API, which
  // returns empty content for files over 1 MB. One un-truncated GitHub 502 HTML page
  // (~55 kB) recorded per app pushed the file past that limit and 500'd every page.
  const MAX_MARK_ERROR = 500;
  const mark = (
    id: string, k: string, ok: boolean,
    opts: { error?: string; rows?: number } = {},
  ) => {
    if (!ok) hadFailure = true;
    const error = opts.error && opts.error.length > MAX_MARK_ERROR
      ? `${opts.error.slice(0, MAX_MARK_ERROR)}… [truncated]`
      : opts.error;
    (status.perApp[id] ??= {})[k] = {
      ok, at: new Date().toISOString(),
      ...(error ? { error } : {}),
      ...(opts.rows !== undefined ? { rows: opts.rows } : {}),
    };
  };

  // Each app's meta lives at a distinct path, so read+write them in parallel rather
  // than 2×N sequential GitHub round-trips — a serial loop here eats into the 60s
  // Hobby cap and was a contributor to the FUNCTION_INVOCATION_TIMEOUT runs. Guarded
  // per-app so one transient Contents API error doesn't reject the whole collection.
  await Promise.all(apps.map(async (a) => {
    try {
      const prev = await store.readJson<AppMeta | null>(appMetaPath(a.appId), null);
      const merged: AppMeta = prev ? { ...a, firstSeen: prev.firstSeen, hidden: prev.hidden, archived: prev.archived, releases: prev.releases } : a;
      await store.writeJson(appMetaPath(a.appId), merged, `chore(data): meta ${a.appId}`);
      // Success mark, or a stale meta failure (e.g. a transient 409) survives the status
      // merge forever and keeps lastSuccess permanently empty.
      mark(a.appId, "meta", true);
    } catch (e: any) { mark(a.appId, "meta", false, { error: String(e?.message ?? e) }); }
  }));

  const appIds = apps.map((a) => a.appId);
  let salesByApp: Record<string, any> = {};
  // Skip the account-wide sales walk entirely when this run collects no apps (the refresh
  // "finish" phase, appIds: []) — otherwise collectSales walks all 5 lag days looking for a
  // row that can never match an empty app set, burning ~5 sequential ASC TSV fetches for nothing.
  if (apps.length > 0) {
    try {
      salesByApp = await deps.collectSales(apps, day);
      appIds.forEach((id) => mark(id, "sales", true, { rows: salesByApp[id] ? 1 : 0 }));
    } catch (e: any) {
      appIds.forEach((id) => mark(id, "sales", false, { error: String(e?.message ?? e) }));
    }
  }

  // Per-app work runs in parallel — each app writes to distinct paths so there's no
  // contention, and the GitHub Contents API handles concurrent commits. Serial loop
  // blew the 60s Hobby function cap once analytics started doing real CSV downloads.
  const perApp = apps.map(async (a) => {
    const id = a.appId;
    // Sales rows carry a lagged report date (see cron route); file them under their own
    // day so a month-boundary lag lands in the correct month file. The write is guarded
    // (like every other per-app write below): a transient GitHub Contents API error must
    // mark this source failed, never reject Promise.all and 500 the whole cron.
    if (salesByApp[id]) {
      try {
        const sd = salesByApp[id].day ?? day;
        await store.upsertDailyArray(salesPath(id, sd), [salesByApp[id]], `data: sales ${id} ${sd}`);
      } catch (e: any) { mark(id, "sales", false, { error: String(e?.message ?? e) }); }
    }

    // Collect + persist in one guarded block so a write failure is recorded against the
    // source instead of escaping the parallel pass.
    try {
      const analyticsDays = await deps.collectAnalytics(id);
      const aDays = Object.values(analyticsDays) as AnalyticsDay[];
      // The analytics report is a rolling multi-day window that can straddle a month boundary. File
      // each row under ITS OWN month (like the sales write above) — dumping the whole window into
      // today's month file duplicated late-previous-month days across two files, which double-counts
      // in funnel/breakdown reads and resolves to stale values in day-keyed maps.
      const byMonth = new Map<string, AnalyticsDay[]>();
      for (const r of aDays) {
        const arr = byMonth.get(r.day.slice(0, 7));
        if (arr) arr.push(r); else byMonth.set(r.day.slice(0, 7), [r]);
      }
      for (const rows of byMonth.values()) {
        await store.upsertDailyArray(analyticsPath(id, rows[0].day), rows as any[], `data: analytics ${id} ${rows[0].day.slice(0, 7)}`, mergeAnalyticsDay as (p: any, i: any) => any);
      }
      mark(id, "analytics", true, { rows: aDays.length });
    } catch (e: any) { mark(id, "analytics", false, { error: String(e?.message ?? e) }); }

    try {
      const reviews = await deps.collectReviews(id);
      if (reviews.length) {
        const prevReviews = await store.readJson<Review[]>(reviewsPath(id), []);
        const map = new Map(prevReviews.map((r) => [r.id, r]));
        for (const r of reviews) map.set(r.id, r);
        await store.writeJson(reviewsPath(id), [...map.values()], `data: reviews ${id}`);
      }
      mark(id, "reviews", true, { rows: reviews.length });
    } catch (e: any) { mark(id, "reviews", false, { error: String(e?.message ?? e) }); }

    try { const rp = await deps.collectRatings(id, day); await store.upsertDailyArray(ratingsPath(id, day), [rp], `data: ratings ${id} ${day}`); mark(id, "ratings", true, { rows: 1 }); }
    catch (e: any) { mark(id, "ratings", false, { error: String(e?.message ?? e) }); }

    try {
      const watch = config.apps[id]?.keywords ?? [];
      const kr = await deps.collectKeywords(id, day);
      if (kr.length) await store.upsertDailyArray(keywordsPath(id, day), kr, `data: keywords ${id} ${day}`);
      void watch;
      mark(id, "keywords", true, { rows: kr.length });
    } catch (e: any) { mark(id, "keywords", false, { error: String(e?.message ?? e) }); }
  });
  await Promise.all(perApp);

  // Intelligence must reflect EVERY app, not just the ones collected in this (possibly
  // partial) run — the cron processes a rotating batch and the refresh collects in batches.
  // Build the inputs from the persisted store for all discovered apps so a full run and a
  // batch run converge on the same insights.
  if (runIntel) {
    try {
      const intelInputs = await buildIntelInputsFromStore(store, allApps, day);
      const insights = await deps.runIntelligence({ day, apps: intelInputs });
      await store.writeJson(insightsPath(), insights, `data: insights ${day}`);
      // Mark success explicitly — without it, a stale failed mark (and its error string)
      // survives the status merge below forever, since the merge only overwrites keys
      // this run marked.
      allApps.forEach((a) => mark(a.appId, "intelligence", true));
    } catch (e: any) {
      allApps.forEach((a) => mark(a.appId, "intelligence", false, { error: String(e?.message ?? e) }));
    }
  }

  // Merge this run's marks into the existing status so a batch run updates only the apps it
  // touched and never blanks the others. lastSuccess reflects whole-portfolio health: set
  // only when no app — including ones collected in an earlier batch — carries a failed mark.
  // Best-effort: a transient status write never discards the work already done.
  try {
    const prev = await store.readJson<RunStatus>(runStatusPath(), { lastRun: "", lastSuccess: "", perApp: {} });
    const perAppMerged: RunStatus["perApp"] = { ...prev.perApp };
    for (const [id, marks] of Object.entries(status.perApp)) {
      perAppMerged[id] = { ...perAppMerged[id], ...marks };
    }
    const anyFailure = Object.values(perAppMerged).some((m) => Object.values(m).some((x) => !x.ok));
    const now = new Date().toISOString();
    const merged: RunStatus = { lastRun: now, lastSuccess: anyFailure ? "" : now, perApp: perAppMerged };
    await store.writeJson(runStatusPath(), merged, `data: run-status ${day}`);
    return merged;
  } catch {
    status.lastSuccess = hadFailure ? "" : new Date().toISOString();
    return status;
  }
}
