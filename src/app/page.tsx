import Link from "next/link";
import { Nav } from "@/components/glass/Nav";
import { Stat } from "@/components/glass/Stat";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { buildGlance, visibleAppIds } from "@/lib/aggregate/api";
import { runStatusPath, dashboardsPath, insightsPath, type RunStatus } from "@/lib/store/paths";
import type { Insights } from "@/lib/intelligence/engine";
import { buildActionItems } from "@/lib/intelligence/actions";
import { ActionCard } from "@/components/insights/ActionCard";
import { todayUtc } from "@/lib/dates";
import { ConfigurableDashboard } from "@/components/dashboard/ConfigurableDashboard";
import { defaultsFor } from "@/lib/dashboards/defaults";
import { migrateSlice } from "@/lib/dashboards/migrate";
import { loadRawBundle } from "@/lib/aggregate/rawBundle";
import type { DashboardsFile } from "@/lib/dashboards/types";

export const dynamic = "force-dynamic";

function fmtAgo(iso: string): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))} min ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-05-31" → "31 May". Parsed from the string parts (no Date) to avoid any
// timezone shift on the date label.
function fmtDay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]}`;
}

export default async function Glance() {
  const store = makeStore(ghBackendFromEnv(), { cacheReads: true });
  const status = await store.readJson<RunStatus | null>(runStatusPath(), null);
  const ids = await visibleAppIds(store);
  const g = await buildGlance(store, ids, todayUtc().slice(0, 7));
  const dashboards = await store.readJson<DashboardsFile>(dashboardsPath(), { byId: {} });
  const glanceSlice = migrateSlice(dashboards.byId["glance"] ?? defaultsFor("glance"));
  const raw = await loadRawBundle(store, ids, todayUtc(), 4);
  const insights = await store.readJson<Insights>(insightsPath(), { generatedAt: "", apps: {} });
  const topActions = buildActionItems(insights).slice(0, 3);
  const dashboardApps = ids.map((id) => ({ id, name: raw.apps[id]?.name ?? id }));
  const total = g.apps.reduce((s, a) => s + a.total, 0);
  // Latest-day total sums only apps that HAVE data for the shared latest day; an app still lagging
  // contributes null → 0 here and renders "N/A" in its row (never a stale value under a newer date).
  const today = g.apps.reduce((s, a) => s + (a.today ?? 0), 0);
  const naCount = g.apps.filter((a) => a.today === null).length;
  const rating = g.blendedRating;
  const latestDay = g.latestDay;
  const lastRunCopy = status
    ? `Last cron ${fmtAgo(status.lastRun)} · ${ids.length} app${ids.length === 1 ? "" : "s"} discovered`
    : "First cron hasn't run. Either wait for 06:00 UTC or trigger /api/cron with the secret.";
  const dataThroughCopy = latestDay
    ? `App Store data through ${fmtDay(latestDay)} — Apple publishes downloads 24–48h late, so the current day is not a bug. AdMob revenue is near real-time.${naCount > 0 ? ` ${naCount} app${naCount === 1 ? "" : "s"} show N/A — no download data yet.` : ""}`
    : null;
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Glance</h1>
      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total downloads" value={total.toLocaleString()} />
        <Stat label="Latest-day downloads" value={today.toLocaleString()} />
        <Stat label="Avg rating" value={rating.count ? `${rating.avg.toFixed(2)}★` : "—"} />
        <Stat label="Apps tracked" value={String(g.apps.length)} />
      </div>
      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-2)]">Needs your attention</h2>
          <Link href="/insights" className="text-xs text-[var(--accent)] hover:underline">View all →</Link>
        </div>
        {topActions.length > 0 ? (
          <div className="glass divide-y divide-[var(--chart-grid)] px-4 py-1">
            {topActions.map((item, i) => (
              <ActionCard key={`${item.appId}-${item.kind}-${i}`} item={item} variant="compact" />
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--ink-2)]">All clear — nothing needs action right now.</p>
        )}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <p className="text-xs text-[var(--muted,#666)]">{lastRunCopy}</p>
      </div>
      {dataThroughCopy && <p className="mb-4 text-xs text-[var(--ink-2)]">{dataThroughCopy}</p>}
      <div className="grid gap-3">
        {g.apps.map((a) => (
          <Link key={a.appId} href={`/app/${a.appId}`} className="glass glass-link block p-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate font-semibold">{a.name}</span>
              <span className="flex items-center gap-2 whitespace-nowrap">
                {a.rating?.count ? <span className="text-xs text-[var(--star)]">★ {a.rating.avg.toFixed(2)}</span> : null}
                {a.today === null ? (
                  <span className="num text-lg text-[var(--ink-2)]" title="No download data yet">N/A</span>
                ) : (
                  <span className="num text-lg">
                    <span className="font-semibold">{a.today}</span> latest
                    {a.latestDay && a.latestDay !== latestDay ? (
                      <span className="ml-1 text-xs text-[var(--ink-2)]" title={`This app's latest day (others reach ${fmtDay(latestDay)})`}>· {fmtDay(a.latestDay)}</span>
                    ) : null}
                  </span>
                )}
                <span aria-hidden className="text-[var(--ink-2)]">›</span>
              </span>
            </div>
            {a.anomaly && (
              <div className={`mt-2 text-sm ${a.anomaly.direction === "drop" ? "text-[var(--bad)]" : "text-[var(--ok)]"}`}>
                {a.anomaly.direction === "drop" ? "▼" : "▲"} {a.anomaly.metric}: {a.anomaly.cause}
              </div>
            )}
          </Link>
        ))}
        {g.apps.length === 0 && status && (
          <Card>
            <div className="text-sm">
              Cron ran successfully but the data is still <strong>all zeros</strong>. This is expected
              on day-0: Apple&apos;s Sales/Analytics reports have a ~24h publication lag, ratings
              update as users rate. Tomorrow&apos;s 06:00 UTC run will pick up yesterday&apos;s
              numbers.
            </div>
          </Card>
        )}
        {g.apps.length === 0 && !status && (
          <Card>No cron run yet. Trigger <code>/api/cron</code> with the bearer secret or wait until 06:00 UTC.</Card>
        )}
      </div>
      <ConfigurableDashboard id="glance" initial={glanceSlice} raw={raw} apps={dashboardApps} />
    </main>
  );
}
