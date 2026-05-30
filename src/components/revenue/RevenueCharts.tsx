"use client";
import { useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

export interface SeriesPoint {
  label: string; // YYYY-MM-DD (daily) or YYYY-MM (monthly)
  earnings: number;
  impressions: number;
  requests: number;
  ecpm: number;
}
export interface Breakdown {
  name: string;
  earnings: number;
  impressions: number;
}

const PALETTE = ["var(--accent)", "#7c9cff", "#5ec8a0", "#e0a458", "#d97aa6", "#8a8df0"];

export function RevenueCharts({
  daily, monthly, byApp, byAdUnit, currency,
}: {
  daily: SeriesPoint[];
  monthly: SeriesPoint[];
  byApp: Breakdown[];
  byAdUnit: Breakdown[];
  currency: string;
}) {
  const [gran, setGran] = useState<"daily" | "monthly">("daily");
  const series = gran === "daily" ? daily : monthly;
  const cur = (n: number) => `${n.toFixed(2)} ${currency}`;

  const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="glass p-4">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--ink-2)]">{title}</div>
      {children}
    </div>
  );

  return (
    <div className="grid gap-4">
      <div className="flex gap-1">
        {(["daily", "monthly"] as const).map((g) => (
          <button
            key={g}
            onClick={() => setGran(g)}
            className={`rounded-xl px-3 py-1.5 text-sm capitalize ${
              gran === g ? "bg-[var(--accent)] text-white" : "glass hover:bg-white/50"
            }`}
          >
            {g === "daily" ? "Per day" : "Per month"}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Estimated earnings (${currency})`}>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="g-earn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
              <Tooltip formatter={(v) => cur(Number(v))} />
              <Area type="monotone" dataKey="earnings" stroke="var(--accent)" strokeWidth={2.5} fill="url(#g-earn)" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Impressions">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
              <Tooltip />
              <Bar dataKey="impressions" fill="var(--accent)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Ad requests">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
              <Tooltip />
              <Line type="monotone" dataKey="requests" stroke="#7c9cff" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title={`eCPM (${currency} per 1000 impressions)`}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
              <Tooltip formatter={(v) => cur(Number(v))} />
              <Line type="monotone" dataKey="ecpm" stroke="#5ec8a0" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {(byApp.length > 0 || byAdUnit.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Earnings by app (lifetime)">
            <ResponsiveContainer width="100%" height={Math.max(120, byApp.length * 44)}>
              <BarChart data={byApp} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => cur(Number(v))} />
                <Bar dataKey="earnings" radius={[0, 4, 4, 0]}>
                  {byApp.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Earnings by ad unit (lifetime)">
            <ResponsiveContainer width="100%" height={Math.max(120, byAdUnit.length * 44)}>
              <BarChart data={byAdUnit} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => cur(Number(v))} />
                <Bar dataKey="earnings" radius={[0, 4, 4, 0]}>
                  {byAdUnit.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      )}
    </div>
  );
}
