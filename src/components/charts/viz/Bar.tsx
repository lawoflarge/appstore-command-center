"use client";
import { BarChart, Bar as B, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { SeriesData } from "@/lib/dashboards/types";

export function Bar({ data }: { data: Extract<SeriesData, { kind: "bar" }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
        <Tooltip />
        <B dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
