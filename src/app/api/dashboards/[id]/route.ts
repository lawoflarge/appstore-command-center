import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { dashboardsPath } from "@/lib/store/paths";
import { defaultsFor } from "@/lib/dashboards/defaults";
import { migrateSlice } from "@/lib/dashboards/migrate";
import { dashboardSliceSchema } from "@/lib/dashboards/schema";
import type { DashboardsFile } from "@/lib/dashboards/types";

type Ctx = { params: Promise<{ id: string }> };

async function readFile() {
  const store = makeStore(ghBackendFromEnv());
  return await store.readJson<DashboardsFile>(dashboardsPath(), { byId: {} });
}

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const file = await readFile();
  const slice = migrateSlice(file.byId[id] ?? defaultsFor(id));
  return NextResponse.json(slice);
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = dashboardSliceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid", detail: parsed.error.format() }, { status: 400 });

  const store = makeStore(ghBackendFromEnv());
  const file = await readFile();
  const updatedAt = new Date().toISOString();
  const next: DashboardsFile = {
    byId: { ...file.byId, [id]: { cards: parsed.data.cards, updatedAt } },
  };
  await store.writeJson(dashboardsPath(), next, `chore(dashboards): update ${id}`);
  return NextResponse.json({ updatedAt });
}
