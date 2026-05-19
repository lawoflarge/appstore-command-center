import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { buildGlance } from "@/lib/aggregate/api";
import { todayUtc } from "@/lib/dates";

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { path } = await ctx.params;
  const store = makeStore(ghBackendFromEnv());
  const month = todayUtc().slice(0, 7);
  if (path[0] === "glance") {
    const { searchParams } = new URL(req.url);
    const ids = (searchParams.get("apps") ?? "").split(",").filter(Boolean);
    return NextResponse.json(await buildGlance(store, ids, month));
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
