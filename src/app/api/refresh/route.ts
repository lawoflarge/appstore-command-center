import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { runFullCollection } from "@/lib/runCollection";

export const maxDuration = 60;

// On-demand collection — same work as the daily cron, triggered by the in-app
// "Refresh" button. Edge middleware already gates this path to the single allowed
// GitHub user; the session check here is defense-in-depth so the route can never
// run unauthenticated even if the matcher changes.
export async function POST(): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { status, admob } = await runFullCollection();
  return NextResponse.json({ ok: true, status, admob });
}
