"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { MonthlyRevenue } from "@/lib/aggregate/revenue-monthly";

const euro = (value: number) => new Intl.NumberFormat("en-IE", {
  style: "currency", currency: "EUR", minimumFractionDigits: 2,
}).format(value);
const monthName = (month: string) => new Date(`${month}-01T12:00:00Z`)
  .toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dateName = (day: string | null) => day
  ? new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
  : "No report";
const COLORS = { oneTime: "var(--accent)", subscriptions: "#16866b", ads: "#be791f", other: "#858aa1" };

function RevenueMetric({ label, value, forecast, current, color }: {
  label: string; value: number | null; forecast: number | null; current: boolean; color: string;
}) {
  return (
    <div className="glass flex min-w-0 flex-col p-5">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--ink-2)]">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden="true" />
        {label}
      </div>
      <div className="num mt-3 break-words text-2xl font-bold tracking-tight">{value === null ? "Unavailable" : euro(value)}</div>
      <div className="mt-3 border-t border-[var(--chart-grid)] pt-3 text-xs text-[var(--ink-2)]">
        {current
          ? <><span>Month-end estimate</span><strong className="num ml-2 text-[var(--ink)]">{forecast === null ? "Not enough data" : euro(forecast)}</strong></>
          : "Reported for this month"}
      </div>
    </div>
  );
}

export function MonthlyRevenueOverview({ revenue, months }: { revenue: MonthlyRevenue; months: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { totals, forecast } = revenue;
  const through = [revenue.latestAppleDay, revenue.latestAdmobDay].filter((day): day is string => day !== null).sort().at(-1);
  let running = 0;
  const cumulative: { day: string; dayNumber: number; actual: number | null; projected: number | null }[] = revenue.byDay
    .filter((point) => through && point.day <= through)
    .map((point) => {
      running += point.total;
      return { day: point.day, dayNumber: Number(point.day.slice(-2)), actual: Math.round(running * 100) / 100, projected: null };
    });
  const last = cumulative.at(-1);
  const monthEnd = `${revenue.month}-${String(revenue.daysInMonth).padStart(2, "0")}`;
  if (last && revenue.isCurrentMonth && forecast.total !== null && last.day < monthEnd) {
    last.projected = last.actual;
    cumulative.push({ day: monthEnd, dayNumber: revenue.daysInMonth, actual: null, projected: forecast.total });
  }
  const hasData = revenue.latestAppleDay !== null || revenue.latestAdmobDay !== null;

  return (
    <section aria-labelledby="monthly-revenue-heading" aria-busy={pending} className="mb-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-2)]">Monthly overview</p>
          <h2 id="monthly-revenue-heading" className="text-2xl font-semibold tracking-tight">{monthName(revenue.month)}</h2>
        </div>
        <div className="flex items-center gap-3">
          {pending && <span role="status" className="text-xs text-[var(--ink-2)]">Loading month…</span>}
          <label htmlFor="revenue-month" className="sr-only">Revenue month</label>
          <select id="revenue-month" value={revenue.month} disabled={pending}
            onChange={(event) => {
              const month = event.target.value;
              startTransition(() => router.replace(`/revenue?month=${encodeURIComponent(month)}`, { scroll: false }));
            }}
            className="glass min-h-11 cursor-pointer px-4 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-60">
            {months.map((month) => <option key={month} value={month}>{monthName(month)}</option>)}
          </select>
        </div>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[1.1fr_2fr]">
        <div className="glass relative overflow-hidden p-6 sm:p-7">
          <div className="pointer-events-none absolute -right-12 -top-16 h-52 w-52 rounded-full bg-[var(--accent)]/10 blur-3xl" aria-hidden="true" />
          <div className="relative">
            <p className="text-sm font-medium text-[var(--ink-2)]">App revenue</p>
            <p className="num mt-2 text-5xl font-bold tracking-tight">{hasData ? euro(totals.total) : "Unavailable"}</p>
            <p className="mt-3 max-w-sm text-xs leading-relaxed text-[var(--ink-2)]">Apple developer proceeds and AdMob earnings. Kickbacks is reported separately.</p>
            {revenue.isCurrentMonth && (
              <div className="mt-6 border-t border-[var(--chart-grid)] pt-4">
                <p className="text-xs text-[var(--ink-2)]">Linear month-end estimate</p>
                <p className="num mt-1 text-2xl font-semibold">{forecast.total === null ? "Not enough data" : euro(forecast.total)}</p>
              </div>
            )}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <RevenueMetric label="One-time purchases" value={totals.oneTime} forecast={forecast.oneTime} current={revenue.isCurrentMonth} color={COLORS.oneTime} />
          <RevenueMetric label="Subscriptions" value={totals.subscriptions} forecast={forecast.subscriptions} current={revenue.isCurrentMonth} color={COLORS.subscriptions} />
          <RevenueMetric label="AdMob ads" value={revenue.latestAdmobDay === null ? null : totals.ads} forecast={forecast.ads} current={revenue.isCurrentMonth} color={COLORS.ads} />
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 px-1 text-xs text-[var(--ink-2)]">
        <span>Apple through <strong className="font-medium text-[var(--ink)]">{dateName(revenue.latestAppleDay)}</strong></span>
        <span>AdMob through <strong className="font-medium text-[var(--ink)]">{dateName(revenue.latestAdmobDay)}</strong></span>
        <span>EUR · estimated proceeds · refunds included</span>
      </div>

      {((!revenue.classificationComplete && revenue.latestAppleDay !== null) || revenue.missingFxRows > 0 || totals.otherApple !== 0) && (
        <div className="mb-5 rounded-2xl border border-amber-600/20 bg-amber-50/70 p-4 text-sm leading-relaxed text-amber-950" role="note">
          {!revenue.classificationComplete && revenue.latestAppleDay !== null && <p>Some Apple reports do not contain a purchase-type breakdown. {euro(totals.unclassifiedApple)} is included in app revenue but cannot yet be assigned to purchases or subscriptions.</p>}
          {totals.otherApple !== 0 && <p>Other Apple proceeds: {euro(totals.otherApple)}. These remain included in app revenue.</p>}
          {revenue.missingFxRows > 0 && <p>{revenue.missingFxRows} Apple report {revenue.missingFxRows === 1 ? "row lacks" : "rows lack"} a verified EUR conversion and {revenue.missingFxRows === 1 ? "is" : "are"} excluded from these totals.</p>}
        </div>
      )}

      {hasData ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="glass min-w-0 p-5">
            <h3 className="text-sm font-semibold">Revenue over the month</h3>
            <p className="mb-5 mt-1 text-xs text-[var(--ink-2)]">Cumulative app revenue{revenue.isCurrentMonth && forecast.total !== null ? "; dotted line shows the month-end estimate." : "."}</p>
            <div role="img" aria-label={`Cumulative app revenue for ${monthName(revenue.month)}: ${euro(totals.total)}${revenue.isCurrentMonth && forecast.total !== null ? `; month-end estimate ${euro(forecast.total)}` : ""}`}>
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={cumulative} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="dayNumber" type="number" domain={[1, revenue.daysInMonth]} allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={18} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => `€${value}`} />
                  <Tooltip labelFormatter={(day) => dateName(`${revenue.month}-${String(day).padStart(2, "0")}`)} formatter={(value, name) => [euro(Number(value)), name === "actual" ? "Reported revenue" : "Linear estimate"]} />
                  <ReferenceLine y={0} stroke="var(--chart-grid)" />
                  <Line type="linear" dataKey="actual" stroke="var(--accent)" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
                  <Line type="linear" dataKey="projected" stroke="var(--accent)" strokeWidth={2.5} strokeDasharray="5 5" dot={false} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="glass min-w-0 p-5">
            <h3 className="text-sm font-semibold">Daily revenue mix</h3>
            <div className="mb-4 mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--ink-2)]">
              {[["One-time", COLORS.oneTime], ["Subscriptions", COLORS.subscriptions], ["Ads", COLORS.ads]].map(([name, color]) => (
                <span key={name} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden="true" />{name}</span>
              ))}
              {(totals.unclassifiedApple !== 0 || totals.otherApple !== 0) && <span>Other / unclassified Apple</span>}
            </div>
            <div role="img" aria-label="Daily app revenue by purchases, subscriptions and ads. Negative values include refunds.">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={revenue.byDay} stackOffset="sign" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="day" tickFormatter={(day: string) => String(Number(day.slice(-2)))} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={18} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => `€${value}`} />
                  <Tooltip labelFormatter={(day) => dateName(String(day))} formatter={(value) => euro(Number(value))} />
                  <ReferenceLine y={0} stroke="var(--chart-grid)" />
                  <Bar dataKey="oneTime" name="One-time purchases" stackId="revenue" fill={COLORS.oneTime} isAnimationActive={false} />
                  <Bar dataKey="subscriptions" name="Subscriptions" stackId="revenue" fill={COLORS.subscriptions} isAnimationActive={false} />
                  <Bar dataKey="ads" name="AdMob ads" stackId="revenue" fill={COLORS.ads} isAnimationActive={false} />
                  <Bar dataKey="otherApple" name="Other Apple" stackId="revenue" fill={COLORS.other} isAnimationActive={false} />
                  <Bar dataKey="unclassifiedApple" name="Unclassified Apple" stackId="revenue" fill="#b7bac8" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : (
        <div className="glass p-6 text-sm text-[var(--ink-2)]">No revenue reports are available for this month yet.</div>
      )}

      {revenue.isCurrentMonth && (
        <p className="mt-4 px-1 text-xs leading-relaxed text-[var(--ink-2)]">
          Linear estimates extend each source&apos;s reported daily average to {revenue.daysInMonth} days.
          Apple uses {forecast.appleDays} calendar days through {dateName(forecast.appleThrough)}; AdMob uses {forecast.adDays} through {dateName(forecast.adsThrough)}.
          These are projections, not guaranteed revenue or recurring ARR.
        </p>
      )}
    </section>
  );
}
