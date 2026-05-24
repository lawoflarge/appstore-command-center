import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { LineArea } from "@/components/charts/LineArea";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { salesPath, analyticsPath, appMetaPath, type SalesDay, type AnalyticsDay, type AppMeta } from "@/lib/store/paths";
import { downloadsSeries, analyticsDownloadsSeries } from "@/lib/aggregate/downloads";
import { todayUtc } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function AppDetail({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const store = makeStore(ghBackendFromEnv());
  const month = todayUtc().slice(0, 7) + "-01";
  const meta = await store.readJson<AppMeta | null>(appMetaPath(appId), null);
  const analytics = await store.readJson<AnalyticsDay[]>(analyticsPath(appId, month), []);
  const sales = await store.readJson<SalesDay[]>(salesPath(appId, month), []);
  const series = analytics.length > 0 ? analyticsDownloadsSeries(analytics) : downloadsSeries(sales);
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">{meta?.name ?? appId}</h1>
      <Card><LineArea data={series} /></Card>
    </main>
  );
}
