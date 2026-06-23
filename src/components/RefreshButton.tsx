"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { chunk } from "@/lib/batch";

// Per-batch app count. The full collection can't finish in one Vercel Hobby invocation (60s
// cap → 504), so the refresh runs as a sequence of small POSTs the client drives: one "start"
// (AdMob + discovery), then per-app batches of this size, then one "finish" (intelligence).
const BATCH_SIZE = 4;

// Triggers an on-demand collection (same work as the daily cron) and re-renders the page with
// the fresh data. App Store Connect data lags ~24-48h, so a refresh only surfaces a new day
// once Apple has published it — AdMob revenue is near-real-time and updates right away.
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`refresh failed (${res.status})`);
    return res.json();
  }

  async function refresh() {
    setErr(null);
    setBusy(true);
    setStage("Starting…");
    try {
      const start = await post({ phase: "start" });
      const appIds: string[] = Array.isArray(start.appIds) ? start.appIds : [];
      const batches = chunk(appIds, BATCH_SIZE);
      let done = 0;
      for (const batch of batches) {
        setStage(`Syncing ${done + batch.length}/${appIds.length} apps…`);
        await post({ phase: "collect", appIds: batch });
        done += batch.length;
      }
      setStage("Finishing…");
      await post({ phase: "finish" });
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "refresh failed");
    } finally {
      setBusy(false);
      setStage(null);
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
      {loading && stage ? <span className="text-xs text-[var(--ink-2)]">{stage}</span> : null}
      {err ? <span className="text-xs text-[var(--bad)]">{err}</span> : null}
    </span>
  );
}
