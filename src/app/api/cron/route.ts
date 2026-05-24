import { NextResponse } from "next/server";
import { env } from "@/env";
import { todayUtc } from "@/lib/dates";
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
import { configPath, type Config } from "@/lib/store/paths";

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
      collectSales: (ids, d) => collectSales(ascFetchSalesTsv(key, e.ASC_VENDOR_NUMBER), ids, d),
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
  return NextResponse.json({ ok: true, status });
}
