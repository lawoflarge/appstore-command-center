import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { LineArea } from "@/components/charts/LineArea";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { salesPath, appMetaPath, type SalesDay, type AppMeta } from "@/lib/store/paths";
import { downloadsSeries } from "@/lib/aggregate/downloads";
import { todayUtc } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function AppDetail({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const store = makeStore(ghBackendFromEnv());
  const meta = await store.readJson<AppMeta | null>(appMetaPath(appId), null);
  const sales = await store.readJson<SalesDay[]>(salesPath(appId, todayUtc().slice(0, 7) + "-01"), []);
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">{meta?.name ?? appId}</h1>
      <Card><LineArea data={downloadsSeries(sales)} /></Card>
    </main>
  );
}
