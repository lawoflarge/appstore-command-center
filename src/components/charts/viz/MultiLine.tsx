"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { SeriesData } from "@/lib/dashboards/types";

const palette = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)"];

type MultiSeries = Extract<SeriesData, { kind: "multiLine" }>["series"];

// Align sparse per-series points onto the union of all days. A day a series has no point for maps
// to null (a GAP), not 0 — paired with `connectNulls={false}` recharts draws a break instead of a
// line plunging to zero. The 0-fill read as a false "downloads crashed to 0" whenever an app simply
// lagged a day behind the others (e.g. one app's data reaches Jun 6 while another stops at Jun 5).
export function multiLineRows(series: MultiSeries): Record<string, number | string | null>[] {
  const allDays = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.day)))).sort();
  return allDays.map((day) => {
    const row: Record<string, number | string | null> = { day };
    for (const s of series) row[s.key] = s.points.find((p) => p.day === day)?.value ?? null;
    return row;
  });
}

export function MultiLine({ data }: { data: Extract<SeriesData, { kind: "multiLine" }> }) {
  const rows = multiLineRows(data.series);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {data.series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
            stroke={palette[i % palette.length]} strokeWidth={2} dot={false} connectNulls={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
