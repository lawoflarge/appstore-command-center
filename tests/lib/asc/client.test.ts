import { test, expect, vi, afterEach } from "vitest";
import { gzipSync } from "node:zlib";
import { ascGetAllPages, ascGetGzipTsv } from "@/lib/asc/client";

vi.mock("@/lib/asc/jwt", () => ({
  signAscToken: () => "test-token",
}));

const key = { keyId: "k", issuerId: "i", privateKey: "p" };

afterEach(() => vi.restoreAllMocks());

test("ascGetAllPages follows links.next", async () => {
  const pages = [
    { data: [{ id: "1" }], links: { next: "https://api/next" } },
    { data: [{ id: "2" }], links: {} },
  ];
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify(pages[i++]), { status: 200 })));
  const rows = await ascGetAllPages(key, "https://api/start");
  expect(rows.map((r: any) => r.id)).toEqual(["1", "2"]);
});

test("ascGetGzipTsv parses gzipped TSV with header", async () => {
  const tsv = "Units\tCountry Code\n5\tDE\n3\tNL\n";
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(gzipSync(Buffer.from(tsv)), { status: 200 })));
  const rows = await ascGetGzipTsv(key, "https://api/sales");
  expect(rows).toEqual([
    { "Units": "5", "Country Code": "DE" },
    { "Units": "3", "Country Code": "NL" },
  ]);
});

test("ascGetGzipTsv returns [] on 404 (no report yet)", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
  expect(await ascGetGzipTsv(key, "https://api/sales")).toEqual([]);
});
