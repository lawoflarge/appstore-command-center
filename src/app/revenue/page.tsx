import { Nav } from "@/components/glass/Nav";
import { Stat } from "@/components/glass/Stat";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { admobPath, salesPath, appMetaPath, type SalesDay, type AppMeta } from "@/lib/store/paths";
import type { AdMobRow } from "@/lib/sources/admob";
import { todayUtc, rowsInMonth, addDays } from "@/lib/dates";
import { visibleAppIds } from "@/lib/aggregate/api";
import { buildRevenue, buildIapBreakdown } from "@/lib/aggregate/revenue";
import { RevenueCharts, type SeriesPoint, type Breakdown } from "@/components/revenue/RevenueCharts";
import { IapCharts } from "@/components/revenue/IapCharts";

export const dynamic = "force-dynamic";

const CURRENCY = "EUR";
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Acc { earnings: number; impressions: number; requests: number; clicks: number }
const emptyAcc = (): Acc => ({ earnings: 0, impressions: 0, requests: 0, clicks: 0 });
function add(map: Map<string, Acc>, key: string, r: AdMobRow) {
  const a = map.get(key) ?? emptyAcc();
  a.earnings += r.earnings; a.impressions += r.impressions;
  a.requests += r.requests; a.clicks += r.clicks;
  map.set(key, a);
}
const toSeries = (map: Map<string, Acc>): SeriesPoint[] =>
  [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, a]) => ({
    label,
    earnings: round2(a.earnings),
    impressions: a.impressions,
    requests: a.requests,
    ecpm: a.impressions > 0 ? round2((a.earnings / a.impressions) * 1000) : 0,
  }));

function lastMonths(curMonth: string, n: number): string[] {
  const out: string[] = [];
  let [y, m] = curMonth.split("-").map(Number);
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1; if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-05-31" → "31 May", parsed from the string parts to avoid any timezone shift on the label.
function fmtDay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]}` : iso;
}

export default async function Revenue() {
  const store = makeStore(ghBackendFromEnv());
  const now = todayUtc();
  const curMonth = now.slice(0, 7);
  const months = lastMonths(curMonth, 18);
  const arrays = await Promise.all(
    months.map((m) => store.readJson<AdMobRow[]>(admobPath(`${m}-01`), [])),
  );
  const all = arrays.flat();

  // App Store proceeds (IAP / subscriptions) per visible app — month-filtered so Apple's rolling
  // analytics window can't spill a prior month's day into the current file and double-count. Feeds
  // both the unified revenue view (merged with AdMob) and the per-app/per-day IAP breakdown.
  const ids = await visibleAppIds(store);
  const appSales = await Promise.all(ids.map(async (id) => {
    const meta = await store.readJson<AppMeta | null>(appMetaPath(id), null);
    const perMonth = await Promise.all(months.map((m) => store.readJson<SalesDay[]>(salesPath(id, `${m}-01`), [])));
    const sales = perMonth.flatMap((rows, i) => rowsInMonth(rows, `${months[i]}-01`));
    return { appId: id, name: meta?.name ?? id, sales };
  }));
  const rev = buildRevenue(all, appSales.flatMap((a) => a.sales));
  const iap = buildIapBreakdown(appSales);

  const dayMap = new Map<string, Acc>();
  const monMap = new Map<string, Acc>();
  const appMap = new Map<string, { earnings: number; impressions: number }>();
  const unitMap = new Map<string, { earnings: number; impressions: number }>();
  const life = emptyAcc();
  for (const r of all) {
    add(dayMap, r.day, r);
    add(monMap, r.day.slice(0, 7), r);
    const a = appMap.get(r.app) ?? { earnings: 0, impressions: 0 };
    a.earnings += r.earnings; a.impressions += r.impressions; appMap.set(r.app, a);
    const u = unitMap.get(r.adUnit) ?? { earnings: 0, impressions: 0 };
    u.earnings += r.earnings; u.impressions += r.impressions; unitMap.set(r.adUnit, u);
    life.earnings += r.earnings; life.impressions += r.impressions;
    life.requests += r.requests; life.clicks += r.clicks;
  }

  const daily = toSeries(dayMap).slice(-90);
  const monthly = toSeries(monMap);
  const byApp: Breakdown[] = [...appMap.entries()]
    .map(([name, v]) => ({ name, earnings: round2(v.earnings), impressions: v.impressions }))
    .sort((a, b) => b.earnings - a.earnings);
  const byAdUnit: Breakdown[] = [...unitMap.entries()]
    .map(([name, v]) => ({ name, earnings: round2(v.earnings), impressions: v.impressions }))
    .sort((a, b) => b.earnings - a.earnings);

  const thisMonth = monMap.get(curMonth)?.earnings ?? 0;
  // AdMob "today" is almost always 0 — estimates lag a few hours, and the OAuth refresh token
  // expires silently (Google revokes them after 7 days while the consent screen is in "Testing"),
  // which freezes the data. Show the latest day we actually have + flag staleness, not a misleading 0.
  const admobDays = [...dayMap.keys()].sort();
  const latestAdmobDay = admobDays.at(-1) ?? "";
  const latestAdmobEarnings = latestAdmobDay ? dayMap.get(latestAdmobDay)!.earnings : 0;
  // AdMob estimates settle within hours, so the freshest day should be today or yesterday. If the
  // newest day we have is older than yesterday, collection has been failing (typically the expired
  // token) — flag it. (today 07, newest 05 → 05 < 06 → stale.)
  const admobStale = latestAdmobDay !== "" && latestAdmobDay < addDays(now, -1);
  const ecpm = life.impressions > 0 ? (life.earnings / life.impressions) * 1000 : 0;
  const eur = (n: number) => `${n.toFixed(2)} ${CURRENCY}`;

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <main>
      <Nav />
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Revenue</h1>
      <p className="mb-5 text-xs text-[var(--ink-2)]">
        Total revenue across every app — AdMob ads plus App Store in-app purchases &amp; subscriptions.
        Estimated and pre-finalization; amounts summed at reported value (no FX conversion).
      </p>

      {/* Unified revenue: ads + in-app/subscriptions */}
      <section className="mb-6">
        <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Total revenue" value={eur(rev.total)} />
          <Stat label="Ad revenue" value={eur(rev.adEarnings)} />
          <Stat label="In-app & subs" value={eur(rev.iapProceeds)} />
          <Stat label="Ad share" value={rev.total > 0 ? pct(rev.adShare) : "—"} />
        </div>
        <Card className="text-xs text-[var(--ink-2)]">
          {rev.iapProceeds > 0
            ? <>In-app &amp; subscription proceeds come from Apple&apos;s daily sales report (Sales and Trends; ~24–48h lag, pre-finalization). Ads are AdMob estimates.</>
            : <>No in-app or subscription proceeds reported yet. App Store IAP/subscription proceeds appear here from Apple&apos;s daily sales report (Sales and Trends), ~24–48h after a sale.</>}
        </Card>
      </section>

      {/* In-app purchases & subscriptions — broken down by app and by day */}
      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">In-app purchases &amp; subscriptions</h2>
        <p className="mb-4 text-xs text-[var(--ink-2)]">
          App Store developer proceeds from in-app purchases &amp; subscriptions, by app and by day.
          From Apple&apos;s daily sales report (Sales and Trends; ~24–48h lag, pre-finalization).
          Amounts summed at reported value (no FX). Apple reports proceeds, not a transaction count.
        </p>
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="IAP &amp; subs total" value={eur(iap.totalProceeds)} />
          <Stat label="Apps earning" value={String(iap.appsWithRevenue)} />
          <Stat label="IAP share" value={rev.total > 0 ? pct(rev.iapShare) : "—"} />
          <Stat label="Top app" value={iap.byApp[0]?.name ?? "—"} />
        </div>
        {iap.totalProceeds > 0 ? (
          <IapCharts byDay={iap.byDay} byApp={iap.byApp} currency={CURRENCY} />
        ) : (
          <Card className="text-sm">
            No in-app or subscription proceeds reported yet. They appear here from Apple&apos;s daily
            sales report (Sales and Trends), ~24–48h after a sale.
          </Card>
        )}
      </section>

      <h2 className="mb-2 text-lg font-semibold">Ad revenue (AdMob)</h2>
      <p className="mb-4 text-xs text-[var(--ink-2)]">
        Publisher pub-6563643868702361. Estimated, pre-finalization.
      </p>

      {admobStale && (
        <Card className="mb-4 border border-[var(--bad,#c0392b)] text-sm">
          ⚠ AdMob earnings haven&apos;t updated since <strong>{fmtDay(latestAdmobDay)}</strong> — the
          data is stale. The OAuth refresh token has most likely expired (Google revokes them after
          7&nbsp;days while the consent screen is in &quot;Testing&quot;). Renew it via{" "}
          <code>admob-oauth.mjs</code>, then update <code>ADMOB_REFRESH_TOKEN</code> in Vercel and{" "}
          <code>.env.local</code>; publish the OAuth consent screen to stop the 7-day expiry.
        </Card>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Lifetime earnings" value={eur(life.earnings)} />
        <Stat label="This month" value={eur(thisMonth)} />
        <Stat label={latestAdmobDay ? `Latest day · ${fmtDay(latestAdmobDay)}` : "Latest day"} value={eur(latestAdmobEarnings)} />
        <Stat label="Blended eCPM" value={eur(ecpm)} />
        <Stat label="Lifetime impressions" value={life.impressions.toLocaleString()} />
        <Stat label="Ad requests" value={life.requests.toLocaleString()} />
        <Stat label="Clicks" value={life.clicks.toLocaleString()} />
        <Stat label="Apps earning" value={String(byApp.length)} />
      </div>

      {all.length === 0 ? (
        <Card>
          <div className="text-sm">
            No AdMob data yet. Once <code>ADMOB_CLIENT_ID</code> / <code>ADMOB_CLIENT_SECRET</code> /{" "}
            <code>ADMOB_REFRESH_TOKEN</code> are set in the environment, the daily cron pulls earnings
            into <code>data/admob/&lt;YYYY-MM&gt;.json</code>. Trigger <code>/api/cron</code> with the
            bearer secret or wait for 06:00 UTC. Estimated earnings also have AdMob&apos;s own reporting
            lag.
          </div>
        </Card>
      ) : (
        <RevenueCharts daily={daily} monthly={monthly} byApp={byApp} byAdUnit={byAdUnit} currency={CURRENCY} />
      )}
    </main>
  );
}
