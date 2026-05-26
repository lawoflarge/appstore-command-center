"use client";
import { AreaChart, Area as A, XAxis, YAxis, Tooltip, ResponsiveContainer, Line } from "recharts";
import type { SeriesData } from "@/lib/dashboards/types";

export function Area({ data }: { data: Extract<SeriesData, { kind: "area" }> }) {
  const compareMap = new Map((data.compare ?? []).map((p) => [p.day, p.value]));
  const rows = data.points.map((p) => ({ day: p.day, value: p.value, compare: compareMap.get(p.day) }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="g-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
        <Tooltip />
        {data.compare && (
          <Line type="monotone" dataKey="compare" stroke="var(--ink-2)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
        )}
        <A type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2.5} fill="url(#g-area)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
