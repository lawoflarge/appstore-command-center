import { test, expect, vi, afterEach } from "vitest";
import { ghGetJson, ghPutJson } from "@/lib/store/github";

const cfg = { repo: "o/r", token: "t", branch: "main" };
afterEach(() => vi.restoreAllMocks());

test("ghGetJson returns null on 404", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
  expect(await ghGetJson(cfg, "data/x.json")).toBeNull();
});

test("ghGetJson decodes base64 content", async () => {
  const content = Buffer.from(JSON.stringify({ a: 1 })).toString("base64");
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ content, sha: "s1" }), { status: 200 })));
  const r = await ghGetJson<{ a: number }>(cfg, "data/x.json");
  expect(r).toEqual({ value: { a: 1 }, sha: "s1" });
});

test("ghPutJson sends sha when updating", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await ghPutJson(cfg, "data/x.json", { a: 2 }, "oldsha", "msg");
  const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
  expect(body.sha).toBe("oldsha");
  expect(body.branch).toBe("main");
  expect(Buffer.from(body.content, "base64").toString()).toContain('"a": 2');
});
