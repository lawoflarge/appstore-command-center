import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { insightsPath, keywordsPath, type KeywordRank } from "@/lib/store/paths";
import { visibleAppIds } from "@/lib/aggregate/api";
import { todayUtc } from "@/lib/dates";
import type { Insights, AppInsight } from "@/lib/intelligence/engine";

export const dynamic = "force-dynamic";

// Latest known rank per (term, country) from this month's keyword history.
function latestRanks(rows: KeywordRank[]): { term: string; country: string; rank: number | null }[] {
  const latest = new Map<string, KeywordRank>();
  for (const r of rows) {
    const key = `${r.term}|${r.country}`;
    const prev = latest.get(key);
    if (!prev || r.day > prev.day) latest.set(key, r);
  }
  return [...latest.values()]
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .map((r) => ({ term: r.term, country: r.country, rank: r.rank }));
}

function rankColor(rank: number | null): string {
  if (rank == null) return "text-[var(--ink-2)]";
  if (rank <= 10) return "text-[var(--ok)]";
  if (rank <= 25) return "text-[var(--star)]";
  return "text-[var(--ink-2)]";
}

export default async function Aso() {
  const store = makeStore(ghBackendFromEnv(), { cacheReads: true });
  const month = todayUtc().slice(0, 7);
  const ids = await visibleAppIds(store);
  const insights = await store.readJson<Insights>(insightsPath(), { generatedAt: "", apps: {} });
  const perApp = await Promise.all(
    ids.map(async (id) => ({
      id,
      ranks: latestRanks(await store.readJson<KeywordRank[]>(keywordsPath(id, `${month}-01`), [])),
      insight: insights.apps[id] as AppInsight | undefined,
    })),
  );

  return (
    <main>
      <Nav />
      <h1 className="mb-1 text-2xl font-bold tracking-tight">ASO / Growth</h1>
      <p className="mb-5 text-sm text-[var(--ink-2)]">
        Storefront search-result position for each watched keyword (free iTunes Search API — a trend
        signal, not paid ASA or exact organic rank), plus the funnel-leak diagnosis per app.
      </p>

      <div className="grid gap-4">
        {perApp.map(({ id, ranks, insight }) => (
          <Card key={id}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{insight?.name ?? id}</span>
              <span className="text-xs text-[var(--ink-2)]">{ranks.length} keyword{ranks.length === 1 ? "" : "s"} tracked</span>
            </div>
            <div className="mt-1 text-sm text-[var(--ink-2)]">{insight?.funnel?.message ?? "Funnel data warming up."}</div>

            {ranks.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {ranks.map((r) => (
                  <span key={`${r.term}|${r.country}`} className="flex items-center gap-1.5 rounded-full bg-[var(--chart-grid)] px-2.5 py-1 text-xs">
                    <span>{r.term}</span>
                    <span className="uppercase opacity-60">{r.country}</span>
                    <span className={`num font-semibold ${rankColor(r.rank)}`}>{r.rank == null ? "—" : `#${r.rank}`}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-sm text-[var(--ink-2)]">No keywords watched yet. Add terms on the Settings page.</div>
            )}
          </Card>
        ))}
        {perApp.length === 0 && <Card>No apps yet. Trigger <code>/api/cron</code> or wait for 06:00 UTC.</Card>}
      </div>
    </main>
  );
}
