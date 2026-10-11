import { Nav } from "@/components/glass/Nav";
import { Stat } from "@/components/glass/Stat";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { admobPath, kickbacksPath, salesPath, appMetaPath, subscriptionsPath, admobCoveragePath, type AdMobReportCoverage, type SalesDay, type AppMeta, type KickbacksDay, type SubscriptionSnapshot } from "@/lib/store/paths";
import type { AdMobRow } from "@/lib/sources/admob";
import { rowsInMonth, addDays } from "@/lib/dates";
import { visibleAppIds } from "@/lib/aggregate/api";
import { buildRevenue } from "@/lib/aggregate/revenue";
import { buildMonthlyRevenue } from "@/lib/aggregate/revenue-monthly";
import { RevenueCharts, type SeriesPoint, type Breakdown } from "@/components/revenue/RevenueCharts";
import { IapCharts } from "@/components/revenue/IapCharts";
import { MonthlyRevenueOverview } from "@/components/revenue/MonthlyRevenueOverview";
import { ActiveSubscriptions } from "@/components/revenue/ActiveSubscriptions";

export const dynamic = "force-dynamic";
const CURRENCY = "EUR";
const round2 = (n: number) => Math.round(n * 100) / 100;
const eur = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: CURRENCY }).format(n);
const fmtDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

interface Acc { earnings: number; impressions: number; requests: number; clicks: number }
const emptyAcc = (): Acc => ({ earnings: 0, impressions: 0, requests: 0, clicks: 0 });
function add(map: Map<string, Acc>, key: string, r: AdMobRow) {
  const a = map.get(key) ?? emptyAcc();
  a.earnings += r.earnings; a.impressions += r.impressions;
  a.requests += r.requests; a.clicks += r.clicks;
  map.set(key, a);
}
const toSeries = (map: Map<string, Acc>): SeriesPoint[] =>
  [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, a]) => ({
    label, earnings: round2(a.earnings), impressions: a.impressions, requests: a.requests,
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
  // Detail charts share the selected month and the same verified EUR amounts.
  const iapByDay = revenue.byDay.map((point) => ({ day: point.day, proceeds: round2(point.oneTime + point.subscriptions + point.otherApple + point.unclassifiedApple) }));
  const iapByApp = revenue.byApp.map((app) => ({ appId: app.appId, name: app.name, proceeds: app.total }));
  const selectedAds = rowsInMonth(all, `${month}-01`);
  const dayMap = new Map<string, Acc>();
  const monMap = new Map<string, Acc>();
  const appMap = new Map<string, { earnings: number; impressions: number }>();
  const unitMap = new Map<string, { earnings: number; impressions: number }>();
  const ads = emptyAcc();
  for (const r of selectedAds) {
    add(dayMap, r.day, r); add(monMap, r.day.slice(0, 7), r);
    for (const [map, key] of [[appMap, r.app], [unitMap, r.adUnit]] as const) {
      const a = map.get(key) ?? { earnings: 0, impressions: 0 };
      a.earnings += r.earnings; a.impressions += r.impressions; map.set(key, a);
    }
    ads.earnings += r.earnings; ads.impressions += r.impressions;
    ads.requests += r.requests; ads.clicks += r.clicks;
  }
  const breakdown = (map: Map<string, { earnings: number; impressions: number }>): Breakdown[] =>
    [...map.entries()].map(([name, value]) => ({ name, earnings: round2(value.earnings), impressions: value.impressions })).sort((a, b) => b.earnings - a.earnings);
  const latestAdmobDay = [adCoverage?.endDay, ...all.map((row) => row.day)].filter((day): day is string => Boolean(day)).sort().at(-1);
  const completeAdmobDay = adCoverage?.completeThroughDay ?? latestAdmobDay;
  const admobStale = completeAdmobDay !== undefined && completeAdmobDay < addDays(admobToday ?? now, -1);
  const ecpm = ads.impressions > 0 ? ads.earnings / ads.impressions * 1000 : null;
  // Kickbacks' provider-reported lifetime stays separate from monthly app revenue.
  const latestKb = kbAll.at(-1) ?? null;
  const kbLifetime = buildRevenue([], [], kbAll).kbEarnings;
  const kbMonth = round2(rowsInMonth(kbAll, `${month}-01`).reduce((sum, row) => sum + (row.earningsEur ?? 0), 0));

  return (
    <main>
      <Nav />
      <header className="mb-7">
        <h1 className="text-3xl font-bold tracking-tight">Revenue</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--ink-2)]">A clear view of what your apps earned, where it came from, and where this month is heading.</p>
      </header>
      <MonthlyRevenueOverview revenue={revenue} months={availableMonths} />
      <ActiveSubscriptions snapshot={snapshot} />
      <section aria-labelledby="apple-revenue-heading" className="mb-8">
        <h2 id="apple-revenue-heading" className="text-xl font-semibold tracking-tight">Apple proceeds by app</h2>
        <p className="mb-4 mt-1 text-xs text-[var(--ink-2)]">{monthLabel} · developer proceeds after Apple&apos;s commission · converted to EUR using report-day ECB rates</p>
        {revenue.byApp.length > 0 ? <>
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
                  <td className="num px-4 py-4 text-right">{!app.classificationComplete ? "Unclassified" : eur(app.oneTime)}</td>
                  <td className="num px-4 py-4 text-right">{!app.classificationComplete ? "Unclassified" : eur(app.subscriptions)}</td>
                  <td className="num px-4 py-4 text-right text-[var(--ink-2)]">{eur(app.otherApple + app.unclassifiedApple)}</td>
                  <td className="num px-4 py-4 text-right font-semibold">{eur(app.total)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <details>
            <summary className="mb-4 w-fit cursor-pointer rounded-lg px-1 py-2 text-sm font-medium text-[var(--accent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">Explore daily Apple proceeds and app comparison</summary>
            <IapCharts byDay={iapByDay} byApp={iapByApp} currency={CURRENCY} />
          </details>
        </> : <Card className="text-sm text-[var(--ink-2)]">No Apple proceeds are available for this month. Reports normally arrive after the sale date.</Card>}
      </section>
      <section aria-labelledby="admob-revenue-heading" className="mb-8">
        <h2 id="admob-revenue-heading" className="text-xl font-semibold tracking-tight">AdMob performance</h2>
        <p className="mb-4 mt-1 text-xs text-[var(--ink-2)]">{monthLabel} · estimated earnings before finalization</p>
        {admobStale && <div className="mb-4 rounded-2xl border border-amber-600/20 bg-amber-50/70 p-4 text-sm text-amber-950">AdMob reports have not updated since <strong>{fmtDay(latestAdmobDay!)}</strong>. New earnings may be missing; the latest collection needs attention.</div>}
        {selectedAds.length > 0 ? <>
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Ad impressions" value={ads.impressions.toLocaleString()} />
            <Stat label="Ad requests" value={ads.requests.toLocaleString()} />
            <Stat label="Ad clicks" value={ads.clicks.toLocaleString()} />
            <Stat label="Blended eCPM" value={ecpm === null ? "Unavailable" : eur(ecpm)} />
          </div>
          <details>
            <summary className="mb-4 w-fit cursor-pointer rounded-lg px-1 py-2 text-sm font-medium text-[var(--accent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">Explore AdMob charts and app breakdown</summary>
            <RevenueCharts daily={toSeries(dayMap)} monthly={toSeries(monMap)} byApp={breakdown(appMap)} byAdUnit={breakdown(unitMap)} currency={CURRENCY} periodLabel={monthLabel} />
          </details>
        </> : <Card className="text-sm text-[var(--ink-2)]">No AdMob reports are available for this month.</Card>}
      </section>
      <section aria-labelledby="kickbacks-heading">
        <h2 id="kickbacks-heading" className="text-xl font-semibold tracking-tight">Kickbacks</h2>
        <p className="mb-4 mt-1 text-xs text-[var(--ink-2)]">AI wait-time ad earnings, separate from your iOS app revenue.</p>
        {latestKb ? <Card>
          <div className="grid gap-5 sm:grid-cols-3">
            {[["Reported lifetime", eur(kbLifetime)], [`Recorded in ${monthLabel}`, eur(kbMonth)], [`Latest day · ${fmtDay(latestKb.day)}`, eur(latestKb.earningsEur)]].map(([label, value]) => <div key={label}><p className="text-xs text-[var(--ink-2)]">{label}</p><p className="num mt-1 text-2xl font-semibold">{value}</p></div>)}
          </div>
          <p className="mt-5 border-t border-[var(--chart-grid)] pt-4 text-xs leading-relaxed text-[var(--ink-2)]">Kickbacks provides a running lifetime total. The monthly amount includes only daily activity recorded since syncing began, so it may not represent the full month. Estimates are converted to EUR.</p>
        </Card> : <Card className="text-sm text-[var(--ink-2)]">No Kickbacks earnings have been collected yet.</Card>}
      </section>
    </main>
  );
}
