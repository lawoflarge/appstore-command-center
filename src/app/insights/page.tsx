import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { ActionCard } from "@/components/insights/ActionCard";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { insightsPath } from "@/lib/store/paths";
import type { Insights, AppInsight } from "@/lib/intelligence/engine";
import { buildActionItems, type ActionItem, type Severity } from "@/lib/intelligence/actions";

export const dynamic = "force-dynamic";

const SECTIONS: { tier: Severity; heading: string }[] = [
  { tier: "critical", heading: "Needs attention" },
  { tier: "opportunity", heading: "Opportunities" },
  { tier: "good", heading: "Good news" },
];

export default async function InsightsPage() {
  const store = makeStore(ghBackendFromEnv());
  const insights = await store.readJson<Insights>(insightsPath(), { generatedAt: "", apps: {} });
  const items = buildActionItems(insights);
  const entries = Object.entries(insights.apps) as [string, AppInsight][];

  const critical = items.filter((i) => i.severity === "critical").length;
  const opportunity = items.filter((i) => i.severity === "opportunity").length;
  const projected = entries.reduce((s, [, a]) => s + (a.forecast?.projected ?? 0), 0);

  const appsWithItems = new Set(items.map((i) => i.appId));
  const allClear = entries.filter(([id]) => !appsWithItems.has(id)).map(([, a]) => a.name);
  const hasForecast = entries.some(([, a]) => (a.forecast?.projected ?? 0) > 0);

  const byTier = (tier: Severity): ActionItem[] => items.filter((i) => i.severity === tier);

  return (
    <main>
      <Nav />
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Insights</h1>
      <p className="mb-5 text-sm text-[var(--ink-2)]">
        What needs your attention, ranked by urgency. Rules-based signal across the portfolio, regenerated every daily run.
      </p>

      <div className="mb-5 grid grid-cols-3 gap-4">
        <Card><div className="text-[11px] uppercase tracking-wide text-[var(--ink-2)]">Needs attention</div><div className="num mt-1 text-2xl font-bold">{critical}</div></Card>
        <Card><div className="text-[11px] uppercase tracking-wide text-[var(--ink-2)]">Opportunities</div><div className="num mt-1 text-2xl font-bold">{opportunity}</div></Card>
        <Card><div className="text-[11px] uppercase tracking-wide text-[var(--ink-2)]">Projected downloads (mo.)</div><div className="num mt-1 text-2xl font-bold">{Math.round(projected).toLocaleString()}</div></Card>
      </div>

      {SECTIONS.map(({ tier, heading }) => {
        const tierItems = byTier(tier);
        if (tierItems.length === 0) return null;
        return (
          <section key={tier} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--ink-2)]">{heading}</h2>
            <div className="grid gap-3">
              {tierItems.map((item, i) => (
                <ActionCard key={`${item.appId}-${item.kind}-${i}`} item={item} />
              ))}
            </div>
          </section>
        );
      })}

      {items.length === 0 && entries.length > 0 && (
        <Card>All clear — no signal across {entries.length} app{entries.length === 1 ? "" : "s"} right now.</Card>
      )}

      {items.length > 0 && allClear.length > 0 && (
        <p className="mb-6 text-sm text-[var(--ink-2)]">All clear: {allClear.join(", ")}.</p>
      )}

      {hasForecast && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--ink-2)]">Month forecast</h2>
          <div className="grid gap-2">
            {entries.map(([id, a]) => (
              <div key={id} className="flex items-center justify-between rounded-lg bg-[var(--chart-grid)] px-3 py-1.5 text-sm">
                <span>{a.name}</span>
                <span className="num">
                  {Math.round(a.forecast?.projected ?? 0).toLocaleString()}
                  <span className="ml-1 text-xs text-[var(--ink-2)]">({Math.round(a.forecast?.band?.low ?? 0)}–{Math.round(a.forecast?.band?.high ?? 0)})</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {entries.length === 0 && (
        <Card>No insights yet — the first daily run hasn&apos;t produced signal. Trigger <code>/api/cron</code> or wait for 06:00 UTC.</Card>
      )}
    </main>
  );
}
