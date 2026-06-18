import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { appMetaPath, configPath, runStatusPath, type AppConfig, type AppMeta, type Config, type RunStatus } from "@/lib/store/paths";
import { AppSettingsRow } from "@/components/settings/AppSettingsRow";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const store = makeStore(ghBackendFromEnv(), { cacheReads: true });
  const status = await store.readJson<RunStatus | null>(runStatusPath(), null);
  const cfg = await store.readJson<Config>(configPath(), { apps: {} });
  const ids = status ? Object.keys(status.perApp) : [];
  const apps: { meta: AppMeta; cfg: AppConfig }[] = [];
  for (const id of ids) {
    const meta = await store.readJson<AppMeta | null>(appMetaPath(id), null);
    if (!meta) continue;
    const c = cfg.apps[id] ?? { hidden: false, archived: false, keywords: [] };
    apps.push({ meta, cfg: c });
  }
  return (
    <main>
      <Nav />
      <h1 className="mb-2 text-2xl font-bold tracking-tight">Settings</h1>
      <p className="mb-5 text-sm text-[var(--muted,#666)]">
        Hide apps you don&apos;t want on the dashboard. Add keywords per app — the cron tracks each one via
        iTunes Search rank (free, no quota). Empty list = no keyword data on the ASO page for that app.
      </p>
      {apps.length === 0 && <Card>No apps discovered yet — wait for the first cron run.</Card>}
      <div className="grid gap-4">
        {apps.map(({ meta, cfg }) => (
          <Card key={meta.appId}>
            <AppSettingsRow appId={meta.appId} name={meta.name} initial={cfg} />
          </Card>
        ))}
      </div>
    </main>
  );
}
