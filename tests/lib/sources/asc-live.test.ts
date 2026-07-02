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

test("fetchLatestAnalyticsCsv skips instances whose segments 500 and keeps the working ones", async () => {
  // Apple's /segments endpoint returns a sticky HTTP 500 for individual daily instances while
  // adjacent dates succeed (verified live 2026-07-02). One bad instance must NOT abort the whole
  // app's analytics collection — otherwise the rolling window keeps re-including it and downloads
  // freeze indefinitely (the 06-23→07-02 freeze). Skip the broken instance, return the rest.
  vi.resetModules();
  const key = { keyId: "k", issuerId: "i", privateKey: "p" };
  const pageCalls: Record<string, any> = {
    "/v1/analyticsReports/rep_dl/instances?limit=200": {
      data: [
        { id: "dl_ok",  attributes: { processingDate: "2026-07-01", granularity: "DAILY" } },
        { id: "dl_bad", attributes: { processingDate: "2026-06-30", granularity: "DAILY" } },
        { id: "dl_ok2", attributes: { processingDate: "2026-06-29", granularity: "DAILY" } },
      ],
    },
  };
  const allPagesCalls: Record<string, any> = {
    "/v1/analyticsReportRequests/req1/reports?limit=200": [
      { id: "rep_dl", attributes: { name: "App Downloads Standard", category: "COMMERCE" } },
    ],
    "/v1/analyticsReportInstances/dl_ok/segments?limit=200":  [{ attributes: { url: "https://seg/dl_ok" } }],
    "/v1/analyticsReportInstances/dl_ok2/segments?limit=200": [{ attributes: { url: "https://seg/dl_ok2" } }],
  };
  vi.doMock("@/lib/asc/client", () => ({
    ascGetAllPages: vi.fn(async (_k: unknown, u: string) => {
      if (u.includes("dl_bad")) {
        throw new Error(`ASC 500 ${u}: {"errors":[{"status":"500","code":"UNEXPECTED_ERROR"}]}`);
      }
      return allPagesCalls[u] ?? [];
    }),
    ascGetJson: vi.fn(async (_k: unknown, u: string) => pageCalls[u] ?? { data: [] }),
  }));
  const segmentBodies: Record<string, string> = {
    "https://seg/dl_ok":  "Date,Counts,Download Type\n2026-07-01,7,First-time download\n",
    "https://seg/dl_ok2": "Date,Counts,Download Type\n2026-06-29,4,First-time download\n",
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(segmentBodies[url] ?? "", { status: 200 })));

  const { fetchLatestAnalyticsCsv } = await import("@/lib/sources/asc-live");
  const groups = await fetchLatestAnalyticsCsv(key as any, "req1");

  // the broken instance is dropped; the two working ones survive
  expect(groups.map((g) => g.processingDate).sort()).toEqual(["2026-06-29", "2026-07-01"]);
  const joined = groups.flatMap((g) => g.segments).join("\n");
  expect(joined).toContain("2026-07-01,7,First-time download");
  expect(joined).toContain("2026-06-29,4,First-time download");
});

test("fetchLatestAnalyticsCsv throws when EVERY instance's segments fail (real outage, keep observability)", async () => {
  // Partial failure = skip-and-continue. But a total wipeout (Apple fully down) must still surface
  // as analytics:failed in run-status, not silently write zero rows.
  vi.resetModules();
  const key = { keyId: "k", issuerId: "i", privateKey: "p" };
  const pageCalls: Record<string, any> = {
    "/v1/analyticsReports/rep_dl/instances?limit=200": {
      data: [{ id: "dl_bad", attributes: { processingDate: "2026-06-30", granularity: "DAILY" } }],
    },
  };
  vi.doMock("@/lib/asc/client", () => ({
    ascGetAllPages: vi.fn(async (_k: unknown, u: string) => {
      if (u.includes("/segments")) throw new Error(`ASC 500 ${u}`);
      if (u.endsWith("/reports?limit=200")) {
        return [{ id: "rep_dl", attributes: { name: "App Downloads Standard", category: "COMMERCE" } }];
      }
      return [];
    }),
    ascGetJson: vi.fn(async (_k: unknown, u: string) => pageCalls[u] ?? { data: [] }),
  }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));

  const { fetchLatestAnalyticsCsv } = await import("@/lib/sources/asc-live");
  await expect(fetchLatestAnalyticsCsv(key as any, "req1")).rejects.toThrow(/analytics instances failed/);
});

test("fetchLatestAnalyticsCsv keeps one report's data when the OTHER report's instances-listing throws", async () => {
  // The /instances listing is exposed to Apple's 5xx just like /segments. A transient failure listing the
  // Engagement report must not discard the already-collected Downloads groups (same bug class, sibling call).
  vi.resetModules();
  const key = { keyId: "k", issuerId: "i", privateKey: "p" };
  const pageCalls: Record<string, (u: string) => any> = {};
  vi.doMock("@/lib/asc/client", () => ({
    ascGetAllPages: vi.fn(async (_k: unknown, u: string) => {
      if (u.endsWith("/reports?limit=200")) {
        return [
          { id: "rep_dl",  attributes: { name: "App Downloads Standard", category: "COMMERCE" } },
          { id: "rep_eng", attributes: { name: "App Store Discovery and Engagement Standard", category: "APP_STORE_ENGAGEMENT" } },
        ];
      }
      if (u.includes("/analyticsReportInstances/dl_ok/segments")) return [{ attributes: { url: "https://seg/dl_ok" } }];
      return [];
    }),
    ascGetJson: vi.fn(async (_k: unknown, u: string) => {
      if (u === "/v1/analyticsReports/rep_dl/instances?limit=200") {
        return { data: [{ id: "dl_ok", attributes: { processingDate: "2026-07-01", granularity: "DAILY" } }] };
      }
      if (u === "/v1/analyticsReports/rep_eng/instances?limit=200") {
        throw new Error(`ASC 503 ${u}`); // Engagement listing transiently down
      }
      return { data: [] };
    }),
  }));
  void pageCalls;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Date,Counts,Download Type\n2026-07-01,9,First-time download\n", { status: 200 })));

  const { fetchLatestAnalyticsCsv } = await import("@/lib/sources/asc-live");
  const groups = await fetchLatestAnalyticsCsv(key as any, "req1");

  // Downloads survived; Engagement's listing failure did not abort the function
  expect(groups.map((g) => g.report)).toEqual(["App Downloads Standard"]);
  expect(groups[0].processingDate).toBe("2026-07-01");
  expect(groups.flatMap((g) => g.segments).join("")).toContain("2026-07-01,9,First-time download");
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
