"use client";
import { Card } from "@/components/glass/Card";
import { VizRenderer } from "@/components/charts/viz/VizRenderer";
import { buildSeries, type RawBundle } from "@/lib/aggregate/series";
import type { ChartCard, Range } from "@/lib/dashboards/types";
import { useMemo, useState } from "react";

const RANGES: Range[] = ["7d", "30d", "90d", "mtd", "ytd", "all"];

export function ChartCardFrame({
  card, raw, onEdit, onDelete, onMoveUp, onMoveDown,
}: {
  card: ChartCard;
  raw: RawBundle;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [range, setRange] = useState<Range>(card.range);
  const [compare, setCompare] = useState(card.compare === "prevPeriod");
  const series = useMemo(
    () => buildSeries({ ...card, range, compare: compare ? "prevPeriod" : "none" }, raw),
    [card, raw, range, compare],
  );
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{card.title}</h3>
        <div className="flex items-center gap-1">
          <button aria-label="Move up" onClick={onMoveUp} className="rounded px-1.5 py-0.5 text-xs text-[var(--ink-2)] hover:bg-[var(--chart-grid)]">↑</button>
          <button aria-label="Move down" onClick={onMoveDown} className="rounded px-1.5 py-0.5 text-xs text-[var(--ink-2)] hover:bg-[var(--chart-grid)]">↓</button>
          <button aria-label="Edit" onClick={onEdit} className="rounded px-1.5 py-0.5 text-xs hover:bg-[var(--chart-grid)]">✎</button>
          <button aria-label="Delete" onClick={onDelete} className="rounded px-1.5 py-0.5 text-xs hover:bg-[var(--chart-grid)]">🗑</button>
        </div>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-[var(--chart-grid)] text-xs">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2 py-1 ${range === r ? "bg-[var(--accent)] text-white" : "text-[var(--ink-2)] hover:bg-[var(--chart-grid)]"}`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
        {(card.viz === "area" || card.viz === "bar") && (
          <label className="flex items-center gap-1.5 text-xs text-[var(--ink-2)]">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            vs. previous period
          </label>
        )}
      </div>
      <VizRenderer data={series} />
    </Card>
  );
}
