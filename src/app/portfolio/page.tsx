import Link from "next/link";
import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { visibleAppIds, buildGlance } from "@/lib/aggregate/api";
import { rankPortfolio, attentionScore } from "@/lib/aggregate/portfolio";
import { todayUtc } from "@/lib/dates";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-06-23" → "23 Jun" (parsed from parts, no Date → no timezone shift).
function fmtDay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]}` : iso;
}

export default async function Portfolio() {
  const store = makeStore(ghBackendFromEnv(), { cacheReads: true });
  const ids = await visibleAppIds(store);
  const g = await buildGlance(store, ids, todayUtc().slice(0, 7));
  const rows = rankPortfolio(g.apps.map((a) => ({
    ...a, score: attentionScore({ anomalyDrop: a.anomaly?.direction === "drop", ratingDelta: 0, unresponded: 0 }),
  })));
  return (
    <main>
      <Nav />
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Portfolio</h1>
      <p className="mb-5 text-sm text-[var(--ink-2)]">Ranked by attention — anomalies and unresponded reviews float to the top. Tap an app for its full dashboard.</p>
      <div className="grid gap-3">
        {rows.map((a, i) => (
          <Link key={a.appId} href={`/app/${a.appId}`} className="glass glass-link block p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--chart-grid)] text-xs font-semibold text-[var(--ink-2)]">{i + 1}</span>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{a.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--ink-2)]">
                    {a.rating?.count ? <span className="text-[var(--star)]">★ {a.rating.avg.toFixed(2)}</span> : <span>No ratings yet</span>}
                    {a.anomaly && <span className={a.anomaly.direction === "drop" ? "text-[var(--bad)]" : "text-[var(--ok)]"}>{a.anomaly.direction === "drop" ? "▼" : "▲"} {a.anomaly.metric}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="num text-right text-sm">
                  <span className="font-semibold">{a.today ?? "N/A"}</span>
                  {a.today !== null && a.latestDay && a.latestDay !== g.latestDay ? (
                    <span className="ml-1 text-xs text-[var(--ink-2)]">· {fmtDay(a.latestDay)}</span>
                  ) : null}{" "}
                  latest · {a.total.toLocaleString()} total
                </span>
                <span aria-hidden className="text-[var(--ink-2)]">›</span>
              </div>
            </div>
          </Link>
        ))}
        {rows.length === 0 && <Card>No apps yet.</Card>}
      </div>
    </main>
  );
}
