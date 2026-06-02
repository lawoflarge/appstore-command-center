"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Triggers an on-demand collection (same work as the daily cron) and re-renders
// the page with the fresh data. Note: App Store Connect data lags ~24-48h, so a
// refresh only surfaces a new day once Apple has published it — AdMob revenue is
// near-real-time and updates right away.
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      if (!res.ok) throw new Error(`refresh failed (${res.status})`);
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "refresh failed");
    } finally {
      setBusy(false);
    }
  }

  const loading = busy || pending;
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={refresh}
        disabled={loading}
        className="rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Refreshing…" : "Refresh now"}
      </button>
      {err ? <span className="text-xs text-[var(--bad)]">{err}</span> : null}
    </span>
  );
}
