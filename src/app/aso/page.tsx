import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { insightsPath } from "@/lib/store/paths";

export const dynamic = "force-dynamic";

export default async function Aso() {
  const store = makeStore(ghBackendFromEnv());
  const insights = await store.readJson<any>(insightsPath(), { apps: {} });
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">ASO / Growth</h1>
      <div className="grid gap-4">
        {Object.entries<any>(insights.apps).map(([id, a]) => (
          <Card key={id}>
            <div className="font-semibold">{a.name}</div>
            <div className="mt-1 text-sm">{a.funnel?.message ?? "Funnel data warming up."}</div>
            <div className="mt-2 text-sm text-[var(--ink-2)]">
              {(a.opportunities ?? []).map((o: any) => (
                <span key={o.term} className="mr-3">{o.term} #{o.rank} ({o.trend})</span>
              ))}
            </div>
          </Card>
        ))}
        {Object.keys(insights.apps).length === 0 && <Card>No ASO data yet. Add keywords in config and wait for the next run.</Card>}
      </div>
    </main>
  );
}
