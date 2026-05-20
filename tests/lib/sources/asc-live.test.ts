import { test, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

test("fetchLatestAnalyticsCsv walks reports→instances→segments, sorts by processingDate, concatenates", async () => {
  vi.resetModules();
  const key = { keyId: "k", issuerId: "i", privateKey: "p" };
  // Return instances in non-sorted order — code must pick the newest by processingDate
  const calls: Record<string, any> = {
    "/v1/analyticsReportRequests/req1/reports?limit=200": [{ id: "rep1", attributes: { category: "APP_STORE_ENGAGEMENT" } }],
    "/v1/analyticsReports/rep1/instances?limit=200": [
      { id: "inst_old", attributes: { processingDate: "2026-05-10" } },
      { id: "inst_new", attributes: { processingDate: "2026-05-18" } },
    ],
    "/v1/analyticsReportInstances/inst_new/segments?limit=200": [{ attributes: { url: "https://seg/new" } }],
    "/v1/analyticsReportInstances/inst_old/segments?limit=200": [{ attributes: { url: "https://seg/old" } }],
  };
  vi.doMock("@/lib/asc/client", () => ({
    ascGetAllPages: vi.fn(async (_k: unknown, u: string) => calls[u] ?? []),
    ascGetJson: vi.fn(),
  }));
  const fetchMock = vi.fn(async (url: string) => {
    const body = url.endsWith("/new") ? "Date,App Units\n2026-05-18,5\n" : "Date,App Units\n2026-05-10,1\n";
    return new Response(body, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { fetchLatestAnalyticsCsv } = await import("@/lib/sources/asc-live");
  const csv = await fetchLatestAnalyticsCsv(key as any, "req1");
  expect(csv).toContain("2026-05-18,5");
  // Confirms it picked inst_new (the later processingDate), not inst_old
  expect(csv).not.toContain("2026-05-10,1");
});

test("createOngoingRequest POSTs an ONGOING request and returns the new id", async () => {
  vi.resetModules();
  vi.doMock("@/lib/asc/jwt", () => ({ signAscToken: () => "tok" }));
  vi.doMock("@/lib/asc/client", () => ({ ascGetJson: vi.fn(), ascGetAllPages: vi.fn() }));
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: "newreq" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  const { createOngoingRequest } = await import("@/lib/sources/asc-live");
  const r = await createOngoingRequest({ keyId: "k", issuerId: "i", privateKey: "p" } as any, "app9");
  expect(r).toEqual({ id: "newreq" });
  const [url, opts] = fetchMock.mock.calls[0] as [string, any];
  expect(url).toBe("https://api.appstoreconnect.apple.com/v1/analyticsReportRequests");
  expect(opts.method).toBe("POST");
  expect(opts.headers.Authorization).toBe("Bearer tok");
  const body = JSON.parse(opts.body);
  expect(body.data.attributes.accessType).toBe("ONGOING");
  expect(body.data.relationships.app.data.id).toBe("app9");
});

test("createOngoingRequest throws on non-ok", async () => {
  vi.resetModules();
  vi.doMock("@/lib/asc/jwt", () => ({ signAscToken: () => "tok" }));
  vi.doMock("@/lib/asc/client", () => ({ ascGetJson: vi.fn(), ascGetAllPages: vi.fn() }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 409 })));
  const { createOngoingRequest } = await import("@/lib/sources/asc-live");
  await expect(
    createOngoingRequest({ keyId: "k", issuerId: "i", privateKey: "p" } as any, "a"),
  ).rejects.toThrow("create report request 409");
});
