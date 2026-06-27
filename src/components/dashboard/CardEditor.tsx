"use client";
import { useState, useMemo } from "react";
import { buildSeries, type RawBundle } from "@/lib/aggregate/series";
import { VizRenderer } from "@/components/charts/viz/VizRenderer";
import { vizForMetric, breakdownForMetric } from "@/lib/dashboards/compatibility";
import { DEAD_METRICS } from "@/lib/dashboards/migrate";
import type { ChartCard, Metric, Viz, Breakdown, Bucket, Range } from "@/lib/dashboards/types";

const METRICS: { group: string; items: { id: Metric; label: string }[] }[] = [
  { group: "Acquisition", items: [
    { id: "downloads", label: "Downloads" }, { id: "redownloads", label: "Redownloads" },
    { id: "impressions", label: "Impressions" }, { id: "pageViews", label: "Page views" },
  ]},
  { group: "Engagement", items: [
    { id: "sessions", label: "Sessions" }, { id: "activeDevices", label: "Active devices" },
    { id: "deletions", label: "Deletions" },
  ]},
  { group: "Quality", items: [
    { id: "crashes", label: "Crashes" }, { id: "avgRating", label: "Avg rating" },
    { id: "ratingsCount", label: "Ratings count" }, { id: "reviewCount", label: "Review count" },
    { id: "responseRate", label: "Response rate" },
  ]},
  { group: "Money", items: [{ id: "proceedsUsd", label: "Proceeds (EUR)" }]},
  { group: "Derived", items: [
    { id: "convPageToInstall", label: "Page → install conv" },
    { id: "convImpressionToPage", label: "Impression → page conv" },
  ]},
  { group: "Keywords", items: [{ id: "keywordRank", label: "Keyword rank" }]},
];

// Metrics Apple never populates for these low-volume apps (sessions / active devices / deletions
// / crashes) are dropped from the picker so a user can't build a permanently-empty chart. Empty
// groups disappear. See DEAD_METRICS / migrateSlice, which heals any already-saved dead card.
const METRIC_GROUPS = METRICS
  .map((g) => ({ ...g, items: g.items.filter((m) => !DEAD_METRICS.has(m.id)) }))
  .filter((g) => g.items.length > 0);

const ALL_VIZ: Viz[] = ["area", "multiLine", "stackedArea", "bar", "funnel", "smallMultiples", "heatmap"];

export function CardEditor({
  card, raw, apps, dashboardId, onSave, onCancel,
}: {
  card: ChartCard;
  raw: RawBundle;
  apps: { id: string; name: string }[];
  dashboardId: string;
  onSave: (c: ChartCard) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ChartCard>(card);
  const isGlance = dashboardId === "glance";

  const compatibleViz = useMemo(() => {
    const set = new Set<Viz>(vizForMetric(draft.metric));
    set.add("funnel");
    return ALL_VIZ.filter((v) => set.has(v));
  }, [draft.metric]);

  const compatibleBreakdowns = useMemo(() => breakdownForMetric(draft.metric), [draft.metric]);
  const preview = useMemo(() => buildSeries(draft, raw), [draft, raw]);

  function update<K extends keyof ChartCard>(k: K, v: ChartCard[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-[min(420px,100%)] flex-col gap-3 overflow-y-auto border-l border-[var(--glass-br)] bg-[var(--glass)] p-5 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Edit chart</h2>
        <button onClick={onCancel} aria-label="Close" className="text-sm text-[var(--ink-2)]">✕</button>
      </div>

      <label className="text-xs text-[var(--ink-2)]">
        Title
        <input
          aria-label="Title"
          className="mt-1 w-full rounded-md border border-[var(--chart-grid)] bg-white/60 px-2 py-1.5 text-sm"
          value={draft.title}
          onChange={(e) => update("title", e.target.value)}
        />
      </label>

      <label className="text-xs text-[var(--ink-2)]">
        Metric
        <select
          aria-label="Metric"
          className="mt-1 w-full rounded-md border border-[var(--chart-grid)] bg-white/60 px-2 py-1.5 text-sm"
          value={draft.metric}
          onChange={(e) => update("metric", e.target.value as Metric)}
        >
          {METRIC_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>

      <label className="text-xs text-[var(--ink-2)]">
        Visualization
        <select
          aria-label="Visualization"
          className="mt-1 w-full rounded-md border border-[var(--chart-grid)] bg-white/60 px-2 py-1.5 text-sm"
          value={draft.viz}
          onChange={(e) => update("viz", e.target.value as Viz)}
        >
          {compatibleViz.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>

      {isGlance && (
        <fieldset className="text-xs text-[var(--ink-2)]">
          <legend>Apps</legend>
          <label className="mt-1 flex items-center gap-1.5">
            <input type="radio" checked={draft.appIds === "all"} onChange={() => update("appIds", "all")} /> All apps
          </label>
          <label className="mt-1 flex items-center gap-1.5">
            <input type="radio" checked={draft.appIds !== "all"} onChange={() => update("appIds", [apps[0]?.id ?? ""])} /> Pick…
          </label>
          {draft.appIds !== "all" && (
            <div className="mt-1 flex flex-wrap gap-1">
              {apps.map((a) => {
                const selected = (draft.appIds as string[]).includes(a.id);
                return (
                  <button type="button" key={a.id}
                    className={`rounded-full border px-2 py-0.5 text-xs ${selected ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--chart-grid)]"}`}
                    onClick={() => {
                      const cur = draft.appIds as string[];
                      update("appIds", selected ? cur.filter((x) => x !== a.id) : [...cur, a.id]);
                    }}>
                    {a.name}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>
      )}

      <label className="text-xs text-[var(--ink-2)]">
        Breakdown
        <select
          aria-label="Breakdown"
          className="mt-1 w-full rounded-md border border-[var(--chart-grid)] bg-white/60 px-2 py-1.5 text-sm"
          value={draft.breakdown}
          onChange={(e) => update("breakdown", e.target.value as Breakdown)}
        >
          {compatibleBreakdowns.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>

      <label className="text-xs text-[var(--ink-2)]">
        Bucket
        <select
          aria-label="Bucket"
          className="mt-1 w-full rounded-md border border-[var(--chart-grid)] bg-white/60 px-2 py-1.5 text-sm"
          value={draft.bucket}
          onChange={(e) => update("bucket", e.target.value as Bucket)}
        >
          <option value="day">day</option>
          <option value="week">week</option>
          <option value="month">month</option>
        </select>
      </label>

      <label className="text-xs text-[var(--ink-2)]">
        Range
        <select
          aria-label="Range"
          className="mt-1 w-full rounded-md border border-[var(--chart-grid)] bg-white/60 px-2 py-1.5 text-sm"
          value={draft.range}
          onChange={(e) => update("range", e.target.value as Range)}
        >
          {["7d","30d","90d","mtd","ytd","all"].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>

      {draft.metric === "keywordRank" && (
        <label className="text-xs text-[var(--ink-2)]">
          Keyword term
          <input
            aria-label="Keyword term"
            className="mt-1 w-full rounded-md border border-[var(--chart-grid)] bg-white/60 px-2 py-1.5 text-sm"
            value={draft.keywordTerm ?? ""}
            onChange={(e) => update("keywordTerm", e.target.value)}
          />
        </label>
      )}

      <div className="rounded-lg border border-[var(--chart-grid)] p-3">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--ink-2)]">Preview</div>
        <VizRenderer data={preview} />
      </div>

      <div className="mt-auto flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-md border border-[var(--chart-grid)] px-3 py-1.5 text-sm">Cancel</button>
        <button onClick={() => onSave(draft)} className="flex-1 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white">Save</button>
      </div>
    </div>
  );
}
