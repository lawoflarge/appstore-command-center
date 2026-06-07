"use client";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

export interface IapDayPoint { day: string; proceeds: number }
export interface IapAppPoint { appId: string; name: string; proceeds: number }

const PALETTE = ["#5ec8a0", "var(--accent)", "#7c9cff", "#e0a458", "#d97aa6", "#8a8df0"];

// In-app purchase & subscription proceeds — the same "by day" / "by app" treatment the AdMob
// section gets, so IAP/subs revenue is no longer just a single headline number.
export function IapCharts({
  byDay, byApp, currency,
}: {
  byDay: IapDayPoint[];
  byApp: IapAppPoint[];
  currency: string;
}) {
  const cur = (n: number) => `${n.toFixed(2)} ${currency}`;

  const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="glass p-4">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--ink-2)]">{title}</div>
      {children}
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={`Proceeds by day (${currency})`}>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={byDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="g-iap" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5ec8a0" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#5ec8a0" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
            <Tooltip formatter={(v) => cur(Number(v))} />
            <Area type="monotone" dataKey="proceeds" stroke="#5ec8a0" strokeWidth={2.5} fill="url(#g-iap)" />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Proceeds by app">
        <ResponsiveContainer width="100%" height={Math.max(120, byApp.length * 44)}>
          <BarChart data={byApp} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip formatter={(v) => cur(Number(v))} />
            <Bar dataKey="proceeds" radius={[0, 4, 4, 0]}>
              {byApp.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}
