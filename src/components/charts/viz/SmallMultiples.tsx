"use client";
import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";
import type { SeriesData } from "@/lib/dashboards/types";

export function SmallMultiples({ data }: { data: Extract<SeriesData, { kind: "smallMultiples" }> }) {
  const sharedMax = Math.max(1, ...data.series.flatMap((s) => s.points.map((p) => p.value)));
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {data.series.map((s) => (
        <div key={s.key} data-mini-tile="" className="rounded-lg bg-[var(--glass)] p-2">
          <div className="mb-1 truncate text-[11px] text-[var(--ink-2)]">{s.label}</div>
          <div className="num text-lg font-semibold">{s.points.at(-1)?.value.toLocaleString() ?? "—"}</div>
          <ResponsiveContainer width="100%" height={48}>
            <AreaChart data={s.points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <YAxis hide domain={[0, sharedMax]} />
              <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={1.5} fill="var(--accent)" fillOpacity={0.18} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  );
}
