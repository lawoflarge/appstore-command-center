import { NextResponse } from "next/server";
import { env } from "@/env";
import { todayUtc, addDays } from "@/lib/dates";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { runDailyCollection } from "@/lib/orchestrator";
import { ascKeyFromEnv } from "@/lib/asc/jwt";
import { discoverApps, ascFetchApps } from "@/lib/sources/apps";
import { collectSales, ascFetchSalesTsv } from "@/lib/sources/sales";
import { parseAnalyticsCsvs, ensureOngoingRequest } from "@/lib/sources/analytics";
import { listOngoingRequests, createOngoingRequest, fetchLatestAnalyticsCsv } from "@/lib/sources/asc-live";
import { mapReviews, ascFetchReviews } from "@/lib/sources/reviews";
import { collectRatings } from "@/lib/sources/ratings";
import { collectKeywordRanks } from "@/lib/sources/keywords";
import { runIntelligence } from "@/lib/intelligence/engine";
import { configPath, admobPath, type Config } from "@/lib/store/paths";
import { admobConfigured, collectAdmob, type AdMobRow } from "@/lib/sources/admob";

export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const url = new URL(req.url);
  if (!secret || (auth !== `Bearer ${secret}` && url.searchParams.get("key") !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const e = env();
  const key = ascKeyFromEnv(e);
  const store = makeStore(ghBackendFromEnv());
  const day = todayUtc();
  const config = await store.readJson<Config>(configPath(), { apps: {} });

  const status = await runDailyCollection({
    day, store,
    deps: {
      discoverApps: () => discoverApps(ascFetchApps(key), day),
      // Apple's DAILY sales report for `day` doesn't exist yet (it publishes ~24-48h later,
      // longer over weekends). Walk back day-1…day-5 and take the first report that has rows,
      // so proceeds / IAP / subscription revenue actually flow instead of always being empty.
      collectSales: async (ids) => {
        const fetchTsv = ascFetchSalesTsv(key, e.ASC_VENDOR_NUMBER);
        for (let lag = 1; lag <= 5; lag++) {
          const res = await collectSales(fetchTsv, ids, addDays(day, -lag));
          if (Object.keys(res).length > 0) return res;
        }
        return {};
      },
      collectAnalytics: async (appId) => {
        const reqId = await ensureOngoingRequest(appId,
          (id) => listOngoingRequests(key, id),
          (id) => createOngoingRequest(key, id));
        const chunks = await fetchLatestAnalyticsCsv(key, reqId);
        return parseAnalyticsCsvs(chunks);
      },
      collectReviews: async (appId) => mapReviews(await ascFetchReviews(key, appId)()),
      collectRatings: (appId, d) => collectRatings(appId, ["de", "us", "gb", "nl", "fr"], d),
      collectKeywords: (appId, d) => collectKeywordRanks(appId, config.apps[appId]?.keywords ?? [], d),
      runIntelligence: (args) => runIntelligence(args),
    },
  });
  // AdMob ad revenue — account-wide, one API call (not per-app). Refreshes a
  // trailing window so late estimate revisions land; older months persist in
  // their own append-only files. Never fails the cron.
  let admob: { ok: boolean; rows?: number; error?: string } = { ok: false };
  if (admobConfigured(e)) {
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
      admob = { ok: true, rows: rows.length };
    } catch (err) {
      admob = { ok: false, error: String(err instanceof Error ? err.message : err) };
    }
  }
  return NextResponse.json({ ok: true, status, admob });
}
