import type { Store } from "@/lib/store/store";
import { salesPath, appMetaPath, insightsPath, configPath, type SalesDay, type AppMeta, type Config } from "@/lib/store/paths";
import { totals } from "./downloads";

export async function buildGlance(store: Store, appIds: string[], month: string) {
  const insights = await store.readJson<any>(insightsPath(), { apps: {} });
  const apps = [];
  for (const id of appIds) {
    const meta = await store.readJson<AppMeta | null>(appMetaPath(id), null);
    if (!meta || meta.hidden || meta.archived) continue;
    const sales = await store.readJson<SalesDay[]>(salesPath(id, month + "-01"), []);
    const day = sales.at(-1)?.day ?? "";
    apps.push({ appId: id, name: meta.name, ...totals(sales, day), anomaly: insights.apps?.[id]?.anomaly ?? null });
  }
  return { apps };
}

export async function visibleAppIds(store: Store): Promise<string[]> {
  const cfg = await store.readJson<Config>(configPath(), { apps: {} });
  return Object.keys(cfg.apps).length
    ? Object.entries(cfg.apps).filter(([, v]) => !v.hidden && !v.archived).map(([k]) => k)
    : [];
}
