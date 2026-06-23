import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { runRefreshStart, runCollectBatch, runFinish } from "@/lib/runCollection";

export const maxDuration = 60;

// On-demand collection — the same work as the daily cron, but split into client-orchestrated
// phases so no single invocation exceeds Vercel Hobby's 60s cap (the old single-shot full
// collection 504'd: FUNCTION_INVOCATION_TIMEOUT). The RefreshButton calls, in order:
//   { phase: "start" }                  → account-wide AdMob + app discovery, returns appIds
//   { phase: "collect", appIds: [...] } → per-app collection for one small batch (repeated)
//   { phase: "finish" }                 → intelligence across all apps + finalize status
// Edge middleware already gates this path to the single allowed GitHub user; the session check
// here is defense-in-depth so the route can never run unauthenticated even if the matcher changes.
export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const phase = (body as { phase?: string }).phase;

  if (phase === "start") {
    const { appIds, admob } = await runRefreshStart();
    return NextResponse.json({ ok: true, appIds, admob });
  }
  if (phase === "collect") {
    const raw = (body as { appIds?: unknown }).appIds;
    const appIds = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
    const status = await runCollectBatch(appIds);
    return NextResponse.json({ ok: true, status });
  }
  if (phase === "finish") {
    const status = await runFinish();
    return NextResponse.json({ ok: true, status });
  }
  return NextResponse.json({ error: "bad phase" }, { status: 400 });
}
