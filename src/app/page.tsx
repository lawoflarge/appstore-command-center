import { Nav } from "@/components/glass/Nav";
import { Stat } from "@/components/glass/Stat";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { buildGlance, visibleAppIds } from "@/lib/aggregate/api";
import { todayUtc } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function Glance() {
  const store = makeStore(ghBackendFromEnv());
  const ids = await visibleAppIds(store);
  const g = await buildGlance(store, ids, todayUtc().slice(0, 7));
  const total = g.apps.reduce((s, a) => s + a.total, 0);
  const today = g.apps.reduce((s, a) => s + a.today, 0);
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Glance</h1>
      <div className="mb-5 grid grid-cols-3 gap-4">
        <Stat label="Total downloads" value={total.toLocaleString()} />
        <Stat label="Today" value={today.toLocaleString()} />
        <Stat label="Apps tracked" value={String(g.apps.length)} />
      </div>
      <div className="grid gap-4">
        {g.apps.map((a) => (
          <Card key={a.appId}>
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">{a.name}</span>
              <span className="num text-lg">{a.today} today</span>
            </div>
            {a.anomaly && (
              <div className="mt-2 text-sm text-[var(--bad)]">
                {a.anomaly.direction === "drop" ? "▼" : "▲"} {a.anomaly.metric}: {a.anomaly.cause}
              </div>
            )}
          </Card>
        ))}
        {g.apps.length === 0 && <Card>No data yet. The first cron run will populate this.</Card>}
      </div>
    </main>
  );
}
