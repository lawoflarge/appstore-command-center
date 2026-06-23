import { Nav } from "@/components/glass/Nav";
import { ConfigurableDashboard } from "@/components/dashboard/ConfigurableDashboard";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { appMetaPath, dashboardsPath, type AppMeta } from "@/lib/store/paths";
import { defaultsFor } from "@/lib/dashboards/defaults";
import { migrateSlice } from "@/lib/dashboards/migrate";
import { loadRawBundle } from "@/lib/aggregate/rawBundle";
import { todayUtc } from "@/lib/dates";
import type { DashboardsFile } from "@/lib/dashboards/types";

export const dynamic = "force-dynamic";

export default async function AppDetail({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const store = makeStore(ghBackendFromEnv(), { cacheReads: true });
  const meta = await store.readJson<AppMeta | null>(appMetaPath(appId), null);
  const dashboards = await store.readJson<DashboardsFile>(dashboardsPath(), { byId: {} });
  const slice = migrateSlice(dashboards.byId[`app:${appId}`] ?? defaultsFor(`app:${appId}`));
  const raw = await loadRawBundle(store, [appId], todayUtc(), 4);
  const apps = [{ id: appId, name: meta?.name ?? appId }];
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">{meta?.name ?? appId}</h1>
      <ConfigurableDashboard id={`app:${appId}`} initial={slice} raw={raw} apps={apps} />
    </main>
  );
}
