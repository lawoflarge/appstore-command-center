import { NextResponse } from "next/server";
import { discoverAppIds, runCronBatch } from "@/lib/runCollection";
import { selectRoundRobinBatch } from "@/lib/batch";

export const maxDuration = 60;

// Rotation cadence must match the cron interval (the Sync workflow fires every 4h) so each tick
// advances to the next batch. Batch size 4 keeps one invocation ~30s on the current portfolio —
// account-wide AdMob + intelligence is a fixed ~16s, and per-app cost grows super-linearly with
// batch size as ASC starts rate-limiting the parallel requests, so a small batch buys real
// margin under the 60s cap. 4h × 6 runs/day ≥ ceil(apps/4) batches → every app is swept daily.
// Override either with the CRON_APP_BATCH env var / ?batch= query for manual sweeps.
const TICK_MS = 4 * 60 * 60 * 1000;
const DEFAULT_BATCH = 4;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authz = req.headers.get("authorization");
  const url = new URL(req.url);
  if (!secret || (authz !== `Bearer ${secret}` && url.searchParams.get("key") !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Collecting every app in one invocation exceeds Vercel Hobby's 60s cap on the current
  // portfolio (FUNCTION_INVOCATION_TIMEOUT / 504). Instead, each cron tick does the cheap
  // account-wide work (AdMob) + one rotating batch of apps; with a tick every ~4h the whole
  // portfolio is swept across a day. AdMob — the only near-real-time source — refreshes every
  // tick. A thrown collection is caught and returned as a real 500 so the Sync workflow log is
  // debuggable instead of Vercel's empty-body 500.
  try {
    const appIds = await discoverAppIds();
    const batchSize = Number(process.env.CRON_APP_BATCH) || DEFAULT_BATCH;
    const override = url.searchParams.get("batch");
    const runIndex = override !== null ? Number(override) : Math.floor(Date.now() / TICK_MS);
    const batch = selectRoundRobinBatch(appIds, batchSize, runIndex);
    const { status, admob } = await runCronBatch(batch);
    return NextResponse.json({ ok: true, batch, batchOf: appIds.length, status, admob });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
