import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { configPath, type Config } from "@/lib/store/paths";
import { applyConfigPatch } from "./logic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const patch = await req.json();
  const store = makeStore(ghBackendFromEnv());
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const cfg = await store.readJson<Config>(configPath(), { apps: {} });
    const next = applyConfigPatch(cfg, patch);
    try {
      await store.writeJson(configPath(), next, `chore(config): update ${patch.appId}`);
      return NextResponse.json(next);
    } catch (e) {
      lastErr = e;
      if (!String((e as { message?: string })?.message ?? e).includes("GH PUT 409")) throw e;
      // SHA conflict: the cron raced this write — re-read and reapply the patch
    }
  }
  return NextResponse.json(
    { error: "config write conflict, please retry", detail: String((lastErr as { message?: string })?.message ?? lastErr) },
    { status: 409 },
  );
}
