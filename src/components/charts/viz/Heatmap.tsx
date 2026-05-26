"use client";
import type { SeriesData } from "@/lib/dashboards/types";

export function Heatmap({ data }: { data: Extract<SeriesData, { kind: "heatmap" }> }) {
  if (data.points.length === 0) return <div className="text-sm text-[var(--ink-2)]">No data</div>;
  const sorted = [...data.points].sort((a, b) => a.day.localeCompare(b.day));
  const max = Math.max(1, ...sorted.map((p) => p.value));
  const cells: { day: string; value: number; row: number; col: number }[] = [];
  let col = -1, lastWeek = "";
  for (const p of sorted) {
    const d = new Date(p.day + "T00:00:00Z");
    const dow = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - dow);
    const weekKey = monday.toISOString().slice(0, 10);
    if (weekKey !== lastWeek) { col++; lastWeek = weekKey; }
    cells.push({ day: p.day, value: p.value, row: dow, col });
  }
  const size = 12, gap = 2;
  const width = (col + 1) * (size + gap);
  const height = 7 * (size + gap);
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Calendar heatmap">
      {cells.map((c) => {
        const opacity = 0.15 + 0.85 * (c.value / max);
        return (
          <rect
            key={c.day}
            data-heatmap-cell=""
            x={c.col * (size + gap)}
            y={c.row * (size + gap)}
            width={size} height={size} rx={2}
            fill="var(--accent)" fillOpacity={opacity}
          >
            <title>{`${c.day}: ${c.value.toLocaleString()}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
