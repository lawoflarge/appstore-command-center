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

test("ghGetJson throws on non-404 error", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("server error", { status: 500 })));
  await expect(ghGetJson(cfg, "data/x.json")).rejects.toThrow("GH GET 500");
});

test("ghGetJson decodes newline-wrapped base64 (GitHub style)", async () => {
  const b64 = Buffer.from(JSON.stringify({ a: 1 })).toString("base64");
  const wrapped = b64.replace(/(.{2})/, "$1\n");
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ content: wrapped, sha: "s1" }), { status: 200 })));
  expect(await ghGetJson(cfg, "data/x.json")).toEqual({ value: { a: 1 }, sha: "s1" });
});

test("ghPutJson omits sha on create (sha=null)", async () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await ghPutJson(cfg, "data/x.json", { a: 1 }, null, "msg");
  const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
  expect("sha" in body).toBe(false);
});

test("ghPutJson throws on failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 422 })));
  await expect(ghPutJson(cfg, "data/x.json", { a: 1 }, null, "m")).rejects.toThrow("GH PUT 422");
});

test("ghGetJson re-fetches raw when the Contents API omits content (>1MB file)", async () => {
  const value = { big: true };
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const accept = (init?.headers as Record<string, string>)?.Accept ?? "";
    if (accept === "application/vnd.github.raw") {
      return new Response(JSON.stringify(value), { status: 200 });
    }
    return new Response(
      JSON.stringify({ content: "", encoding: "none", size: 1_231_183, sha: "bigsha" }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const r = await ghGetJson<{ big: boolean }>(cfg, "data/run-status.json");
  expect(r).toEqual({ value: { big: true }, sha: "bigsha" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect((fetchMock.mock.calls[1][1] as any).headers.Accept).toBe("application/vnd.github.raw");
});

test("ghGetJson does not raw re-fetch a genuinely empty file (size 0) — parse throws as before", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ content: "", size: 0, sha: "s1" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(ghGetJson(cfg, "data/x.json")).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1); // no second (raw) request
});

test("ghGetJson truncates huge error bodies (GitHub 502 Unicorn HTML page)", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(60_000), { status: 502 })));
  const err = await ghGetJson(cfg, "data/x.json").catch((e: Error) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toContain("GH GET 502");
  expect((err as Error).message.length).toBeLessThan(700);
  expect((err as Error).message).toContain("truncated");
});

test("ghPutJson truncates huge error bodies", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("y".repeat(60_000), { status: 502 })));
  const err = await ghPutJson(cfg, "data/x.json", { a: 1 }, null, "m").catch((e: Error) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toContain("GH PUT 502");
  expect((err as Error).message.length).toBeLessThan(700);
});
