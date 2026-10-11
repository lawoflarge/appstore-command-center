import type { AdMobRow } from "@/lib/sources/admob";
import type { SalesDay, AdMobReportCoverage } from "@/lib/store/paths";

export interface RevenueAppSales { appId: string; name: string; sales: SalesDay[] }
interface Amounts {
  oneTime: number;
  subscriptions: number;
  ads: number;
  otherApple: number;
  unclassifiedApple: number;
  total: number;
}
export interface MonthlyRevenue {
  month: string;
  isCurrentMonth: boolean;
  daysInMonth: number;
  totals: Omit<Amounts, "oneTime" | "subscriptions"> & { oneTime: number | null; subscriptions: number | null };
  forecast: {
    total: number | null; oneTime: number | null; subscriptions: number | null; ads: number | null;
    appleThrough: string | null; adsThrough: string | null; appleDays: number; adDays: number;
  };
  byDay: (Amounts & { day: string })[];
  byApp: Omit<Amounts & { appId: string; name: string; classificationComplete: boolean }, "ads">[];
  classificationComplete: boolean;
  missingFxRows: number;
  latestAppleDay: string | null;
  latestAdmobDay: string | null;
}

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const empty = (): Amounts => ({ oneTime: 0, subscriptions: 0, ads: 0, otherApple: 0, unclassifiedApple: 0, total: 0 });
const keys = ["oneTime", "subscriptions", "ads", "otherApple", "unclassifiedApple", "total"] as const;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

// Largest-remainder allocation keeps app, day and category totals equal to the rounded
// account-day total, including refunds. No currency amount is silently discarded.
function cents(values: number[], target = Math.round(values.reduce((s, n) => s + n, 0) * 100)): number[] {
  const out = values.map((v) => Math.round(v * 100));
  const delta = target - out.reduce((s, n) => s + n, 0);
  const order = values.map((v, i) => ({ i, remainder: v * 100 - out[i] }))
    .sort((a, b) => delta >= 0 ? b.remainder - a.remainder || a.i - b.i : a.remainder - b.remainder || a.i - b.i);
  for (let i = 0; i < Math.abs(delta) && order.length; i++) out[order[i % order.length].i] += Math.sign(delta);
  return out;
}

function euroAmount(row: SalesDay): number | null {
  if (row.proceedsCurrencyMissing) return null;
  if (finite(row.proceedsEur)) return row.proceedsEur;
  const currencies = row.proceedsByCcy ?? {};
  if (Object.keys(currencies).every((ccy) => ccy === "EUR") && Object.keys(currencies).length) {
    return finite(currencies.EUR) ? currencies.EUR : null;
  }
  if (row.proceedsUsd === 0 && Object.values(currencies).every((v) => v === 0)) return 0;
  // The legacy proceedsUsd field can contain mixed currencies; it is not an EUR fallback.
  return null;
}

/** Pure monthly view. `today` is the operator's date; `admobToday` follows the report timezone. */
export function buildMonthlyRevenue(
  apps: RevenueAppSales[], admob: AdMobRow[], month: string, today: string, admobToday: string | null = today, adCoverage: AdMobReportCoverage | null = null,
): MonthlyRevenue {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid revenue month");
  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const isCurrentMonth = month === today.slice(0, 7);
  const dayMap = new Map<string, Amounts>();
  const appMap = new Map<string, Omit<Amounts, "ads"> & { appId: string; name: string; classificationComplete: boolean }>();
  const ledger = new Map<string, { appId: string; name: string; amount: number; parts: number[] }[]>();
  const incompleteApps = new Set<string>();
  let unclassifiedRows = 0;
  let missingFxRows = 0;
  const appleDays: string[] = [];
  const coverage: (string | null)[] = [];
  for (const app of apps) {
    const rows = [...new Map(app.sales.map((row) => [row.day, row])).values()]
      .filter((row) => row.day.startsWith(`${month}-`) && row.day <= today);
    const confirmed = rows.filter((row) => row.reportAvailable && row.day < today).map((row) => row.day).sort();
    coverage.push(confirmed.at(-1) ?? null);
    for (const row of rows) {
      appleDays.push(row.day);
      const amount = euroAmount(row);
      if (amount === null) { missingFxRows++; incompleteApps.add(app.appId); continue; }
      const split = row.proceedsEurByType;
      const hasSplit = split && finite(split.oneTime) && finite(split.subscription) && finite(split.other)
        && Math.abs(split.oneTime + split.subscription + split.other - amount) < 0.011;
      if (!hasSplit && (amount !== 0 || Object.keys(row.proceedsByCcy ?? {}).length > 0)) {
        unclassifiedRows++; incompleteApps.add(app.appId);
      }
      const parts = hasSplit ? [split.oneTime, split.subscription, split.other, 0] : [0, 0, 0, amount];
      const entries = ledger.get(row.day) ?? [];
      entries.push({ appId: app.appId, name: app.name, amount, parts });
      ledger.set(row.day, entries);
    }
  }
  for (const [day, entries] of ledger) {
    const appCents = cents(entries.map((entry) => entry.amount));
    const daily = dayMap.get(day) ?? empty();
    entries.forEach((entry, i) => {
      const [oneTime, subscriptions, otherApple, unclassifiedApple] = cents(entry.parts, appCents[i]).map((n) => n / 100);
      const value = { oneTime, subscriptions, otherApple, unclassifiedApple, total: appCents[i] / 100 };
      const app = appMap.get(entry.appId) ?? { appId: entry.appId, name: entry.name, classificationComplete: !incompleteApps.has(entry.appId), total: 0, oneTime: 0, subscriptions: 0, otherApple: 0, unclassifiedApple: 0 };
      for (const key of ["oneTime", "subscriptions", "otherApple", "unclassifiedApple", "total"] as const) {
        daily[key] = round(daily[key] + value[key]);
        app[key] = round(app[key] + value[key]);
      }
      appMap.set(entry.appId, app);
    });
    dayMap.set(day, daily);
  }
  const adRows = [...new Map(admob.map((row) => [`${row.day}|${row.appId}|${row.adUnit}`, row])).values()]
    .filter((row) => row.day.startsWith(`${month}-`) && (!admobToday || row.day <= admobToday));
  const adDaily = new Map<string, number>();
  for (const row of adRows) adDaily.set(row.day, (adDaily.get(row.day) ?? 0) + row.earnings);
  for (const [day, amount] of adDaily) {
    const daily = dayMap.get(day) ?? empty();
    daily.ads = round(amount);
    daily.total = round(daily.total + daily.ads);
    dayMap.set(day, daily);
  }
  const byDay = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, ...value }));
  const totals = empty();
  for (const point of byDay) for (const key of keys) totals[key] = round(totals[key] + point[key]);
  const classificationComplete = appleDays.length > 0 && unclassifiedRows === 0 && missingFxRows === 0;
  // Apple freshness uses the slowest app's confirmed account report, never its last sale.
  const appleThrough = coverage.length && coverage.every((day) => day !== null)
    ? (coverage as string[]).sort()[0] : null;
  const adsThrough = admobToday && adCoverage?.currencyCode === "EUR"
    && adCoverage.startDay <= `${month}-01` && adCoverage.completeThroughDay?.startsWith(`${month}-`)
    && adCoverage.completeThroughDay < admobToday
    ? adCoverage.completeThroughDay : null;
  const appleDayCount = appleThrough ? Number(appleThrough.slice(-2)) : 0;
  const adDayCount = adsThrough ? Number(adsThrough.slice(-2)) : 0;
  const sumThrough = (key: keyof Amounts, through: string) => byDay.filter((point) => point.day <= through).reduce((sum, point) => sum + point[key], 0);
  const project = (key: keyof Amounts, through: string | null, denominator: number, available: boolean) =>
    isCurrentMonth && available && through && denominator > 0 ? round(sumThrough(key, through) / denominator * daysInMonth) : null;
  const oneTime = project("oneTime", appleThrough, appleDayCount, classificationComplete);
  const subscriptions = project("subscriptions", appleThrough, appleDayCount, classificationComplete);
  const ads = project("ads", adsThrough, adDayCount, true);
  const other = project("otherApple", appleThrough, appleDayCount, classificationComplete);
  const totalForecast = oneTime !== null && subscriptions !== null && ads !== null && other !== null
    ? round(oneTime + subscriptions + ads + other) : null;
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const coveredAdDay = adCoverage?.currencyCode === "EUR" && adCoverage.startDay <= `${month}-01`
    && adCoverage.endDay >= `${month}-01`
    ? (adCoverage.endDay < monthEnd ? adCoverage.endDay : monthEnd) : null;
  return {
    month, isCurrentMonth, daysInMonth,
    totals: { ...totals, oneTime: classificationComplete ? totals.oneTime : null, subscriptions: classificationComplete ? totals.subscriptions : null },
    forecast: { total: totalForecast, oneTime, subscriptions, ads, appleThrough, adsThrough, appleDays: appleDayCount, adDays: adDayCount },
    byDay,
    byApp: [...appMap.values()].filter((app) => app.total !== 0 || app.oneTime !== 0 || app.subscriptions !== 0 || app.unclassifiedApple !== 0 || app.otherApple !== 0)
      .sort((a, b) => b.total - a.total || a.appId.localeCompare(b.appId)),
    classificationComplete, missingFxRows,
    latestAppleDay: appleDays.sort().at(-1) ?? null,
    latestAdmobDay: [...adDaily.keys(), ...(coveredAdDay ? [coveredAdDay] : [])].sort().at(-1) ?? null,
  };
}
