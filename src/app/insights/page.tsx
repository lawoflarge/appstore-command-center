import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { insightsPath } from "@/lib/store/paths";
import type { Insights, AppInsight } from "@/lib/intelligence/engine";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function Rate({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--ink-2)]">{label}</div>
      <div className="num text-lg font-semibold">{value > 0 ? pct(value) : "—"}</div>
    </div>
  );
}

export default async function InsightsPage() {
  const store = makeStore(ghBackendFromEnv());
  const insights = await store.readJson<Insights>(insightsPath(), { generatedAt: "", apps: {} });
  const entries = Object.entries(insights.apps) as [string, AppInsight][];
  const anomalies = entries.filter(([, a]) => a.anomaly).length;
  const leaks = entries.filter(([, a]) => a.funnel?.leak && a.funnel.leak !== "none").length;
  const projected = entries.reduce((s, [, a]) => s + (a.forecast?.projected ?? 0), 0);

  return (
    <main>
      <Nav />
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Insights</h1>
      <p className="mb-5 text-sm text-[var(--ink-2)]">
        Rules-based signal across the portfolio — anomalies, funnel leaks, keyword moves and a
        month-end forecast. Regenerated every daily run.
      </p>

      <div className="mb-5 grid grid-cols-3 gap-4">
        <Card><div className="text-[11px] uppercase tracking-wide text-[var(--ink-2)]">Active anomalies</div><div className="num mt-1 text-2xl font-bold">{anomalies}</div></Card>
        <Card><div className="text-[11px] uppercase tracking-wide text-[var(--ink-2)]">Funnel leaks</div><div className="num mt-1 text-2xl font-bold">{leaks}</div></Card>
        <Card><div className="text-[11px] uppercase tracking-wide text-[var(--ink-2)]">Projected downloads (mo.)</div><div className="num mt-1 text-2xl font-bold">{Math.round(projected).toLocaleString()}</div></Card>
      </div>

      <div className="grid gap-4">
        {entries.map(([id, a]) => (
          <Card key={id}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{a.name}</span>
              {a.anomaly ? (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${a.anomaly.direction === "drop" ? "bg-[var(--bad)]/10 text-[var(--bad)]" : "bg-[var(--ok)]/10 text-[var(--ok)]"}`}>
                  {a.anomaly.direction === "drop" ? "▼" : "▲"} {a.anomaly.metric} anomaly
                </span>
              ) : (
                <span className="text-xs text-[var(--ink-2)]">no anomaly</span>
              )}
            </div>

            {a.anomaly && <div className="mt-1 text-sm text-[var(--ink-2)]">{a.anomaly.cause}</div>}

            <div className="mt-3 flex flex-wrap items-end gap-6">
              <Rate label="Impr → page view" value={a.funnel?.rates?.ipv ?? 0} />
              <Rate label="Page view → install" value={a.funnel?.rates?.pvd ?? 0} />
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--ink-2)]">Forecast (month)</div>
                <div className="num text-lg font-semibold">
                  {Math.round(a.forecast?.projected ?? 0).toLocaleString()}
                  <span className="ml-1 text-xs font-normal text-[var(--ink-2)]">
                    ({Math.round(a.forecast?.band?.low ?? 0)}–{Math.round(a.forecast?.band?.high ?? 0)})
                  </span>
                </div>
              </div>
            </div>

            {a.funnel?.leak && a.funnel.leak !== "none" && (
              <div className="mt-3 rounded-lg bg-[var(--bad)]/8 p-2 text-sm text-[var(--bad)]">{a.funnel.message}</div>
            )}

            {a.opportunities?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {a.opportunities.slice(0, 8).map((o) => (
                  <span key={`${o.term}-${o.country}`} className="rounded-full bg-[var(--chart-grid)] px-2.5 py-1 text-xs">
                    {o.term} <span className="num font-semibold">#{o.rank}</span>
                    <span className={o.trend === "improving" ? "text-[var(--ok)]" : o.trend === "declining" ? "text-[var(--bad)]" : "text-[var(--ink-2)]"}>
                      {" "}{o.trend === "improving" ? "↑" : o.trend === "declining" ? "↓" : "→"}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </Card>
        ))}
        {entries.length === 0 && <Card>No insights yet — the first daily run hasn&apos;t produced signal. Trigger <code>/api/cron</code> or wait for 06:00 UTC.</Card>}
      </div>
    </main>
  );
}
