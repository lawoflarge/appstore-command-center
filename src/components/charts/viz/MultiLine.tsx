"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { SeriesData } from "@/lib/dashboards/types";

const palette = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)"];

export function MultiLine({ data }: { data: Extract<SeriesData, { kind: "multiLine" }> }) {
  const allDays = Array.from(new Set(data.series.flatMap((s) => s.points.map((p) => p.day)))).sort();
  const rows = allDays.map((day) => {
    const row: Record<string, number | string> = { day };
    for (const s of data.series) row[s.key] = s.points.find((p) => p.day === day)?.value ?? 0;
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {data.series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
            stroke={palette[i % palette.length]} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
