import { test, expect, vi } from "vitest";
import { fetchLatestAnalyticsCsv } from "@/lib/sources/asc-live";

test("fetchLatestAnalyticsCsv walks reports→instances→segments and concatenates", async () => {
  const key = { keyId: "k", issuerId: "i", privateKey: "p" };
  const calls: Record<string, any> = {
    "/v1/analyticsReportRequests/req1/reports?limit=200": [{ id: "rep1", attributes: { category: "APP_STORE_ENGAGEMENT" } }],
    "/v1/analyticsReports/rep1/instances?limit=200&sort=-processingDate": [{ id: "inst1", attributes: { processingDate: "2026-05-18" } }],
    "/v1/analyticsReportInstances/inst1/segments?limit=200": [{ attributes: { url: "https://seg/1" } }],
  };
  vi.doMock("@/lib/asc/client", () => ({
    ascGetAllPages: vi.fn(async (_k, u: string) => calls[u] ?? []),
  }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Date,App Units\n2026-05-18,5\n", { status: 200 })));
  const { fetchLatestAnalyticsCsv } = await import("@/lib/sources/asc-live");
  const csv = await fetchLatestAnalyticsCsv(key as any, "req1");
  expect(csv).toContain("2026-05-18,5");
});
