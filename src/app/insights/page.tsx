import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { insightsPath } from "@/lib/store/paths";

export const dynamic = "force-dynamic";

export default async function Insights() {
  const store = makeStore(ghBackendFromEnv());
  const insights = await store.readJson<any>(insightsPath(), { apps: {}, generatedAt: "" });
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Insights</h1>
      <div className="grid gap-4">
        {Object.entries<any>(insights.apps).map(([id, a]) => (
          <Card key={id}>
            <div className="font-semibold">{a.name}</div>
            {a.anomaly && <div className="mt-1 text-sm text-[var(--bad)]">{a.anomaly.cause}</div>}
            {a.funnel?.leak !== "none" && <div className="mt-1 text-sm">{a.funnel.message}</div>}
            {a.opportunities?.length > 0 && (
              <div className="mt-1 text-sm text-[var(--ink-2)]">
                Keyword opportunities: {a.opportunities.slice(0, 5).map((o: any) => `${o.term} (#${o.rank})`).join(", ")}
              </div>
            )}
          </Card>
        ))}
        {Object.keys(insights.apps).length === 0 && <Card>No insights yet.</Card>}
      </div>
    </main>
  );
}
