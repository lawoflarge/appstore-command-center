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

  const { status, admob } = await runFullCollection();
  return NextResponse.json({ ok: true, status, admob });
}
