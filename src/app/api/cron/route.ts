import { NextResponse } from "next/server";
import { runFullCollection } from "@/lib/runCollection";

export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const url = new URL(req.url);
  if (!secret || (auth !== `Bearer ${secret}` && url.searchParams.get("key") !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // A thrown collection used to bubble up as Vercel's generic empty-body 500, which is
  // undiagnosable from the GitHub Actions log. Catch it and return the real error so the
  // run still fails loudly (non-200 → the workflow retries/alerts) but is debuggable.
  try {
    const { status, admob } = await runFullCollection();
    return NextResponse.json({ ok: true, status, admob });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
