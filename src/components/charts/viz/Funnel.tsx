"use client";
import type { SeriesData } from "@/lib/dashboards/types";

const fmt = (n: number) => n.toLocaleString();
const pct = (r?: number) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);

export function Funnel({ data }: { data: Extract<SeriesData, { kind: "funnel" }> }) {
  const max = Math.max(1, ...data.stages.map((s) => s.value));
  return (
    <div className="flex flex-col gap-2 py-2">
      {data.stages.map((s, i) => {
        const widthPct = Math.max(6, Math.round((s.value / max) * 100));
        return (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-24 shrink-0 text-xs text-[var(--ink-2)]">{s.label}</div>
            <div className="relative h-9 flex-1 rounded-md bg-[var(--chart-grid)]">
              <div
                className="absolute inset-y-0 left-0 flex items-center justify-end rounded-md bg-[var(--accent)] pr-2 text-white"
                style={{ width: `${widthPct}%` }}
              >
                <span className="num text-xs font-semibold">{fmt(s.value)}</span>
              </div>
            </div>
            <div className="w-14 shrink-0 text-right text-xs text-[var(--ink-2)]">
              {i === 0 ? "" : pct(s.rate)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
