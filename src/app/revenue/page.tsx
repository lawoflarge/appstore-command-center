import { Nav } from "@/components/glass/Nav";
import { Stat } from "@/components/glass/Stat";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { admobPath, kickbacksPath, salesPath, appMetaPath, subscriptionsPath, admobCoveragePath, type AdMobReportCoverage, type SalesDay, type AppMeta, type KickbacksDay, type SubscriptionSnapshot } from "@/lib/store/paths";
import type { AdMobRow } from "@/lib/sources/admob";
import { rowsInMonth, addDays } from "@/lib/dates";
import { visibleAppIds } from "@/lib/aggregate/api";
import { buildRevenue, buildIapBreakdown } from "@/lib/aggregate/revenue";
import { buildMonthlyRevenue } from "@/lib/aggregate/revenue-monthly";
import { RevenueCharts, type SeriesPoint, type Breakdown } from "@/components/revenue/RevenueCharts";
import { IapCharts } from "@/components/revenue/IapCharts";
import { MonthlyRevenueOverview } from "@/components/revenue/MonthlyRevenueOverview";
import { ActiveSubscriptions } from "@/components/revenue/ActiveSubscriptions";

export const dynamic = "force-dynamic";

const CURRENCY = "EUR";
const round2 = (n: number) => Math.round(n * 100) / 100;
const monthlyEur = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: CURRENCY }).format(n);

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

export default async function Revenue({ searchParams }: { searchParams?: Promise<{ month?: string | string[] }> }) {
  const store = makeStore(ghBackendFromEnv(), { cacheReads: true });
  const currentTime = new Date();
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(currentTime);
  const curMonth = now.slice(0, 7);
  const months = lastMonths(curMonth, 18);
  const [arrays, kbArrays, ids, snapshot, adCoverage] = await Promise.all([
    Promise.all(months.map((m) => store.readJson<AdMobRow[]>(admobPath(`${m}-01`), []))),
    Promise.all(months.map((m) => store.readJson<KickbacksDay[]>(kickbacksPath(`${m}-01`), []))),
    visibleAppIds(store),
    store.readJson<SubscriptionSnapshot | null>(subscriptionsPath(), null),
    store.readJson<AdMobReportCoverage | null>(admobCoveragePath(), null),
  ]);
  const all = arrays.flatMap((rows, i) => rowsInMonth(rows, `${months[i]}-01`));
  const kbAll = kbArrays.flatMap((rows, i) => rowsInMonth(rows, `${months[i]}-01`)).sort((a, b) => a.day.localeCompare(b.day));
  const appSales = await Promise.all(ids.map(async (id) => {
    const [meta, perMonth] = await Promise.all([
      store.readJson<AppMeta | null>(appMetaPath(id), null),
      Promise.all(months.map((m) => store.readJson<SalesDay[]>(salesPath(id, `${m}-01`), []))),
    ]);
    return { appId: id, name: meta?.name ?? id, sales: perMonth.flatMap((rows, i) => rowsInMonth(rows, `${months[i]}-01`)) };
  }));
  const availableMonths = [...new Set([
    curMonth, ...all.map((row) => row.day.slice(0, 7)), ...kbAll.map((row) => row.day.slice(0, 7)),
    ...appSales.flatMap((app) => app.sales.map((row) => row.day.slice(0, 7))),
  ])].filter((month) => months.includes(month)).sort().reverse();
  const requestedMonth = (await searchParams)?.month;
  const month = typeof requestedMonth === "string" && availableMonths.includes(requestedMonth) ? requestedMonth : curMonth;
  const monthLabel = new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const reportingTimeZone = adCoverage?.reportingTimeZone ?? [...all].sort((a, b) => b.day.localeCompare(a.day)).find((row) => row.reportingTimeZone)?.reportingTimeZone;
  let admobToday: string | null = null;
  if (reportingTimeZone) {
    try {
      admobToday = new Intl.DateTimeFormat("en-CA", { timeZone: reportingTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(currentTime);
    } catch { /* An unknown report timezone cannot support a complete-day forecast. */ }
  }
  const revenue = buildMonthlyRevenue(appSales, all, month, now, admobToday, adCoverage);
  const rev = buildRevenue(all, appSales.flatMap((a) => a.sales), kbAll);
  const iap = buildIapBreakdown(appSales);

  // Kickbacks-derived figures for its own section.
  const latestKb = kbAll.at(-1) ?? null;
  const kbThisMonth = round2(kbAll.filter((k) => k.day.slice(0, 7) === curMonth).reduce((s, k) => s + (k.earningsEur ?? 0), 0));
  const kbLifetimeReported = latestKb?.lifetimeEur ?? rev.kbEarnings;

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
  // Coverage also records zero-earning days; freshness follows the provider's report timezone.
  const latestAdmobDay = [adCoverage?.endDay, ...all.map((row) => row.day)].filter((day): day is string => Boolean(day)).sort().at(-1) ?? "";
  const latestAdmobEarnings = dayMap.get(latestAdmobDay)?.earnings ?? 0;
  const completeAdmobDay = adCoverage?.completeThroughDay ?? latestAdmobDay;
  const admobStale = completeAdmobDay !== "" && completeAdmobDay < addDays(admobToday ?? now, -1);
  const ecpm = life.impressions > 0 ? (life.earnings / life.impressions) * 1000 : 0;
  const eur = (n: number) => `${n.toFixed(2)} ${CURRENCY}`;

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <main>
      <Nav />
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Revenue</h1>
      <p className="mb-5 text-xs text-[var(--ink-2)]">
        Total revenue across every app — AdMob ads, App Store in-app purchases &amp; subscriptions,
        and Kickbacks.ai AI-wait-time ads. Estimated and pre-finalization; App Store proceeds and
        Kickbacks are ECB-converted to EUR, AdMob is already in EUR.
      </p>

      {/* Unified revenue: ads + in-app/subscriptions */}
      <section aria-label="All-time revenue" className="mb-6">
        <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="Total revenue" value={eur(rev.total)} />
          <Stat label="Ad revenue" value={eur(rev.adEarnings)} />
          <Stat label="In-app & subs" value={eur(rev.iapProceeds)} />
          <Stat label="Kickbacks" value={eur(rev.kbEarnings)} />
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
          Converted to EUR with the ECB rate of each report day. A refund shows as a negative day on
          the date Apple posts it (Apple reports proceeds, not a transaction count).
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
          AdMob reports have not updated since <strong>{fmtDay(latestAdmobDay)}</strong>.
          New earnings may be missing; the latest collection needs attention.
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

      <h2 className="mb-2 mt-8 text-lg font-semibold">Kickbacks (AI wait-time ads)</h2>
      <p className="mb-4 text-xs text-[var(--ink-2)]">
        Sponsored status-line ads shown in Claude Code / Codex while the agent works — Kickbacks.ai
        pays out 50% of ad revenue. Earnings from the Kickbacks API, converted USD→EUR with ECB daily
        rates. Estimated and pre-finalization.
      </p>
      {kbAll.length === 0 ? (
        <Card className="text-sm">
          No Kickbacks data yet. The <code>kickbacks-sync</code> GitHub Action in the data repo pulls
          earnings into <code>data/kickbacks/&lt;YYYY-MM&gt;.json</code> once the{" "}
          <code>KICKBACKS_GH_PAT</code> secret is set.
        </Card>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Kickbacks lifetime" value={eur(kbLifetimeReported)} />
            <Stat label={latestKb ? `Latest day · ${fmtDay(latestKb.day)}` : "Latest day"} value={eur(latestKb?.earningsEur ?? 0)} />
            <Stat label="This month" value={eur(kbThisMonth)} />
            <Stat label="Share of total" value={rev.total > 0 ? pct(rev.kbShare) : "—"} />
          </div>
          <Card className="text-xs text-[var(--ink-2)]">
            Kickbacks reports a running <strong>lifetime</strong> total (plus today) — it has no
            per-day history like AdMob or the App Store — so the unified &quot;Total revenue&quot; above
            counts the full reported lifetime (€ via ECB daily rates). The daily / this-month figures
            reflect activity since this dashboard started syncing Kickbacks.
          </Card>
        </>
      )}

      {/* Monthly reporting supplements the full-period sections above. */}
      <div className="mt-10 border-t border-[var(--chart-grid)] pt-8">
        <MonthlyRevenueOverview revenue={revenue} months={availableMonths} />
        <section aria-labelledby="apple-revenue-heading" className="mb-8">
          <h2 id="apple-revenue-heading" className="text-xl font-semibold tracking-tight">Apple proceeds by app</h2>
          <p className="mb-4 mt-1 text-xs text-[var(--ink-2)]">{monthLabel} · developer proceeds after Apple&apos;s commission · converted to EUR using report-day ECB rates</p>
          {revenue.byApp.length > 0 ? (
            <div className="glass mb-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <caption className="sr-only">Apple proceeds by app for {monthLabel}</caption>
                <thead className="border-b border-[var(--chart-grid)] text-xs text-[var(--ink-2)]"><tr>
                  <th scope="col" className="px-5 py-3 font-medium">App</th>
                  {["One-time", "Subscriptions", "Other / unclassified", "Total"].map((label) => <th scope="col" key={label} className="px-4 py-3 text-right font-medium">{label}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-[var(--chart-grid)]">
                  {revenue.byApp.map((app) => <tr key={app.appId} className="hover:bg-white/30">
                    <th scope="row" className="px-5 py-4 font-medium">{app.name}</th>
                    <td className="num px-4 py-4 text-right">{!app.classificationComplete ? "Unclassified" : monthlyEur(app.oneTime)}</td>
                    <td className="num px-4 py-4 text-right">{!app.classificationComplete ? "Unclassified" : monthlyEur(app.subscriptions)}</td>
                    <td className="num px-4 py-4 text-right text-[var(--ink-2)]">{monthlyEur(app.otherApple + app.unclassifiedApple)}</td>
                    <td className="num px-4 py-4 text-right font-semibold">{monthlyEur(app.total)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          ) : <Card className="text-sm text-[var(--ink-2)]">No Apple proceeds are available for this month. Reports normally arrive after the sale date.</Card>}
        </section>
        <ActiveSubscriptions snapshot={snapshot} />
      </div>
    </main>
  );
}
