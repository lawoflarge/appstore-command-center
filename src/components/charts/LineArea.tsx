"use client";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export function LineArea({ data }: { data: { day: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6d5dfb" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#6d5dfb" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
        <Tooltip />
        <Area type="monotone" dataKey="value" stroke="#6d5dfb" strokeWidth={2.5} fill="url(#g)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
