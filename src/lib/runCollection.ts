import { env, type Env } from "@/env";
import { todayUtc, addDays } from "@/lib/dates";
import { makeStore, ghBackendFromEnv, type Store } from "@/lib/store/store";
import { runDailyCollection, type OrchestratorDeps } from "@/lib/orchestrator";
import { ascKeyFromEnv, type AscKey } from "@/lib/asc/jwt";
import { discoverApps, ascFetchApps } from "@/lib/sources/apps";
import { collectSales, ascFetchSalesTsv } from "@/lib/sources/sales";
import { parseAnalyticsGroups, ensureOngoingRequest } from "@/lib/sources/analytics";
import { listOngoingRequests, createOngoingRequest, fetchLatestAnalyticsCsv } from "@/lib/sources/asc-live";
import { mapReviews, ascFetchReviews } from "@/lib/sources/reviews";
import { collectRatings } from "@/lib/sources/ratings";
import { collectKeywordRanks } from "@/lib/sources/keywords";
import { runIntelligence } from "@/lib/intelligence/engine";
import { configPath, admobPath, type Config, type RunStatus, type SalesDay } from "@/lib/store/paths";
import { admobConfigured, collectAdmob, type AdMobRow } from "@/lib/sources/admob";
import { fetchEurRates, toEur, type EurRates } from "@/lib/fx";

export type AdmobResult = { ok: boolean; rows?: number; error?: string };

export interface CollectionResult {
  status: RunStatus;
  admob: AdmobResult;
}

// The five per-app collectors + discovery + intelligence, wired to the live ASC client.
// Shared by every entry point (full run, cron batch, refresh batch, finish) so they behave
// identically — only WHICH apps and WHETHER intelligence runs differ, via runDailyCollection's
// `appIds` / `intelligence` options.
function makeDeps(e: Env, key: AscKey, config: Config): OrchestratorDeps {
  return {
    discoverApps: () => discoverApps(ascFetchApps(key), todayUtc()),
    // Apple's DAILY sales report for `day` doesn't exist yet (it publishes ~24-48h later,
    // longer over weekends). Walk back day-1…day-5 and take the first report that has rows,
    // so proceeds / IAP / subscription revenue actually flow instead of always being empty.
    collectSales: async (apps, day) => {
      const fetchTsv = ascFetchSalesTsv(key, e.ASC_VENDOR_NUMBER);
      for (let lag = 1; lag <= 5; lag++) {
        const reportDay = addDays(day, -lag);
        const res = await collectSales(fetchTsv, apps, reportDay);
        if (Object.keys(res).length > 0) {
          // Convert each sale's mixed-currency proceeds to EUR with that report day's ECB rates so
          // the revenue surfaces stop counting e.g. 18.49 BRL as 18.49 €. Best-effort: a failed FX
          // fetch falls back to the static table in toEur; a row whose currency wasn't captured
          // (empty proceedsByCcy) is left without proceedsEur so readers fall back to the raw lump.
          const rates = await fetchEurRates(reportDay).catch(() => ({} as EurRates));
          for (const sd of Object.values(res) as SalesDay[]) {
            if (sd.proceedsByCcy && Object.keys(sd.proceedsByCcy).length > 0) {
              sd.proceedsEur = toEur(sd.proceedsByCcy, rates);
            }
          }
          return res;
        }
      }
      return {};
    },
    collectAnalytics: async (appId) => {
      const reqId = await ensureOngoingRequest(appId,
        (id) => listOngoingRequests(key, id),
        (id) => createOngoingRequest(key, id));
      const groups = await fetchLatestAnalyticsCsv(key, reqId);
      return parseAnalyticsGroups(groups);
    },
    collectReviews: async (appId) => mapReviews(await ascFetchReviews(key, appId)()),
    collectRatings: (appId, d) => collectRatings(appId, ["de", "us", "gb", "nl", "fr"], d),
    collectKeywords: (appId, d) => collectKeywordRanks(appId, config.apps[appId]?.keywords ?? [], d),
    runIntelligence: (args) => runIntelligence(args),
  };
}

// AdMob ad revenue — account-wide, one API call (not per-app). Refreshes a trailing window so
// late estimate revisions land; older months persist in their own append-only files. Never
// throws: a failed AdMob pull must not fail the whole collection.
async function collectAdmobInto(e: Env, store: Store, day: string): Promise<AdmobResult> {
  if (!admobConfigured(e)) return { ok: false };
  try {
    const start = new Date(`${day}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 92);
    const rows = await collectAdmob(e, start.toISOString().slice(0, 10), day);
    const byMonth = new Map<string, AdMobRow[]>();
    for (const r of rows) {
      const m = r.day.slice(0, 7);
      const list = byMonth.get(m) ?? [];
      list.push(r);
      byMonth.set(m, list);
    }
    for (const [m, mrows] of byMonth) {
      await store.upsertKeyedArray(
        admobPath(`${m}-01`), mrows,
        (r) => `${r.day}|${r.appId}|${r.adUnit}`, `data: admob ${m}`,
      );
    }
    return { ok: true, rows: rows.length };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

function setup() {
  const e = env();
  return { e, key: ascKeyFromEnv(e), store: makeStore(ghBackendFromEnv()), day: todayUtc() };
}

// Discover the current app ids (one ASC call). Used by the cron route to pick the round-robin
// batch before delegating the heavy per-app work.
export async function discoverAppIds(): Promise<string[]> {
  const { key, day } = setup();
  return (await discoverApps(ascFetchApps(key), day)).map((a) => a.appId);
}

// ── Refresh: client-orchestrated phases, each bounded well under the 60s cap ──────────────
// The RefreshButton calls these in order: start → collect(batch)×N → finish.

// Phase 1: cheap account-wide work the user most wants fresh on a manual refresh — AdMob is
// near-real-time. Returns the app list so the client can drive the per-app batches.
export async function runRefreshStart(): Promise<{ appIds: string[]; admob: AdmobResult }> {
  const { e, key, store, day } = setup();
  const apps = await discoverApps(ascFetchApps(key), day);
  const admob = await collectAdmobInto(e, store, day);
  return { appIds: apps.map((a) => a.appId), admob };
}

// Phase 2: per-app collection for one batch. No intelligence (deferred to finish) so each call
// stays small.
export async function runCollectBatch(appIds: string[]): Promise<RunStatus> {
  const { e, key, store, day } = setup();
  const config = await store.readJson<Config>(configPath(), { apps: {} });
  return runDailyCollection({ day, store, deps: makeDeps(e, key, config), appIds, intelligence: false });
}

// Phase 3: recompute intelligence across ALL apps from the persisted store + finalize status.
// Collects no per-app data itself (appIds: []).
export async function runFinish(): Promise<RunStatus> {
  const { e, key, store, day } = setup();
  const config = await store.readJson<Config>(configPath(), { apps: {} });
  return runDailyCollection({ day, store, deps: makeDeps(e, key, config), appIds: [], intelligence: true });
}

// ── Cron: one bounded invocation = account-wide AdMob + a rotating app batch + intelligence ──
export async function runCronBatch(appIds: string[]): Promise<CollectionResult> {
  const { e, key, store, day } = setup();
  const config = await store.readJson<Config>(configPath(), { apps: {} });
  const admob = await collectAdmobInto(e, store, day);
  const status = await runDailyCollection({ day, store, deps: makeDeps(e, key, config), appIds, intelligence: true });
  return { status, admob };
}

// Full collection — every app in one invocation. Kept for completeness / small portfolios, but
// NOT used by the cron or refresh routes anymore: on the current portfolio it exceeds the 60s
// Hobby cap (FUNCTION_INVOCATION_TIMEOUT / 504). Prefer the batched paths above.
export async function runFullCollection(): Promise<CollectionResult> {
  const { e, key, store, day } = setup();
  const config = await store.readJson<Config>(configPath(), { apps: {} });
  const status = await runDailyCollection({ day, store, deps: makeDeps(e, key, config), intelligence: true });
  const admob = await collectAdmobInto(e, store, day);
  return { status, admob };
}
