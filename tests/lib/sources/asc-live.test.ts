import { test, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

test("fetchLatestAnalyticsCsv filters reports by name and fetches recent DAILY instances", async () => {
  vi.resetModules();
  const key = { keyId: "k", issuerId: "i", privateKey: "p" };

  const pageCalls: Record<string, any> = {
    "/v1/analyticsReports/rep_dl/instances?limit=200": {
      data: [
        { id: "dl_new",  attributes: { processingDate: "2026-05-18", granularity: "DAILY" } },
        { id: "dl_old",  attributes: { processingDate: "2026-05-17", granularity: "DAILY" } },
        { id: "dl_week", attributes: { processingDate: "2026-05-18", granularity: "WEEKLY" } },
      ],
    },
    "/v1/analyticsReports/rep_eng/instances?limit=200": {
      data: [{ id: "eng_new", attributes: { processingDate: "2026-05-18", granularity: "DAILY" } }],
    },
  };
  const allPagesCalls: Record<string, any> = {
    "/v1/analyticsReportRequests/req1/reports?limit=200": [
      { id: "rep_dl",    attributes: { name: "App Downloads Standard", category: "COMMERCE" } },
      { id: "rep_eng",   attributes: { name: "App Store Discovery and Engagement Standard", category: "APP_STORE_ENGAGEMENT" } },
      { id: "rep_noise", attributes: { name: "Bluetooth LE Scans", category: "FRAMEWORK_USAGE" } },
    ],
    "/v1/analyticsReportInstances/dl_new/segments?limit=200":  [{ attributes: { url: "https://seg/dl_new" } }],
    "/v1/analyticsReportInstances/dl_old/segments?limit=200":  [{ attributes: { url: "https://seg/dl_old" } }],
    "/v1/analyticsReportInstances/eng_new/segments?limit=200": [{ attributes: { url: "https://seg/eng_new" } }],
  };
  vi.doMock("@/lib/asc/client", () => ({
    ascGetAllPages: vi.fn(async (_k: unknown, u: string) => allPagesCalls[u] ?? []),
    ascGetJson: vi.fn(async (_k: unknown, u: string) => pageCalls[u] ?? { data: [] }),
  }));
  const segmentBodies: Record<string, string> = {
    "https://seg/dl_new":  "Date,Counts,Download Type\n2026-05-18,5,First-time download\n",
    "https://seg/dl_old":  "Date,Counts,Download Type\n2026-05-17,3,First-time download\n",
    "https://seg/eng_new": "Date,Counts,Event\n2026-05-18,10,Impression\n",
  };
  const fetchMock = vi.fn(async (url: string) => new Response(segmentBodies[url] ?? "", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  const { fetchLatestAnalyticsCsv } = await import("@/lib/sources/asc-live");
  const groups = await fetchLatestAnalyticsCsv(key as any, "req1");

  expect(groups).toHaveLength(3);
  const joined = groups.flatMap((g) => g.segments).join("\n");
  expect(joined).toContain("2026-05-18,5,First-time download");
  expect(joined).toContain("2026-05-17,3,First-time download");
  expect(joined).toContain("2026-05-18,10,Impression");
  // each group carries its report name + instance recency so the parser can dedupe by date
  expect(groups.map((g) => g.processingDate).sort()).toEqual(["2026-05-17", "2026-05-18", "2026-05-18"]);
  expect(new Set(groups.map((g) => g.report)))
    .toEqual(new Set(["App Downloads Standard", "App Store Discovery and Engagement Standard"]));
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("dl_week"));
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
