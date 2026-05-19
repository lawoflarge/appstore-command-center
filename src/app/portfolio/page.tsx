import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { visibleAppIds, buildGlance } from "@/lib/aggregate/api";
import { rankPortfolio, attentionScore } from "@/lib/aggregate/portfolio";
import { todayUtc } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function Portfolio() {
  const store = makeStore(ghBackendFromEnv());
  const ids = await visibleAppIds(store);
  const g = await buildGlance(store, ids, todayUtc().slice(0, 7));
  const rows = rankPortfolio(g.apps.map((a) => ({
    ...a, score: attentionScore({ anomalyDrop: a.anomaly?.direction === "drop", ratingDelta: 0, unresponded: 0 }),
  })));
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Portfolio</h1>
      <div className="grid gap-3">
        {rows.map((a) => (
          <Card key={a.appId}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">{a.name}</span>
              <span className="num">{a.today} today · {a.total.toLocaleString()} total</span>
            </div>
          </Card>
        ))}
        {rows.length === 0 && <Card>No apps yet.</Card>}
      </div>
    </main>
  );
}
