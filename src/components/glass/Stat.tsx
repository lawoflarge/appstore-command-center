export function Stat({ label, value, delta }: { label: string; value: string; delta?: number }) {
  const cls = delta == null ? "" : delta >= 0 ? "text-[var(--ok)]" : "text-[var(--bad)]";
  return (
    <div className="glass p-5">
      <div className="text-[11px] uppercase tracking-wide text-[var(--ink-2)]">{label}</div>
      <div className="num mt-1 text-3xl font-bold">{value}</div>
      {delta != null && <div className={`mt-1 text-sm font-semibold ${cls}`}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%</div>}
    </div>
  );
}
