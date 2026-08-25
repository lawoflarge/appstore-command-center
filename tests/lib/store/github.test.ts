import { test, expect, vi, afterEach } from "vitest";
import { gzipSync } from "node:zlib";
import { ghGetJson, ghPutJson, ghGetSnapshot } from "@/lib/store/github";

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

// --- Snapshot reads (tarball) -------------------------------------------------
// The dashboard reads ~700 small JSON files per render. One tarball carries all of
// them, so these tests pin the TAR parsing the snapshot path depends on.

/** Build a POSIX ustar entry, splitting long paths across name/prefix like GitHub does. */
function tarEntry(path: string, body: string, type = "0"): Buffer {
  const h = Buffer.alloc(512);
  let name = path, prefix = "";
  if (name.length > 100) {
    // ustar splits at a "/" so that prefix + "/" + name rebuilds the path.
    const i = name.indexOf("/", name.length - 100);
    prefix = name.slice(0, i);
    name = name.slice(i + 1);
  }
  h.write(name, 0, 100, "utf8");
  h.write("0000644\0", 100, 8, "utf8");
  h.write(Buffer.byteLength(body).toString(8).padStart(11, "0") + "\0", 124, 12, "utf8");
  h.write("0".padStart(11, "0") + "\0", 136, 12, "utf8");
  h.write("        ", 148, 8, "utf8"); // checksum placeholder = spaces
  h.write(type, 156, 1, "utf8");       // typeflag: "0" file, "5" dir, "g" pax global header
  h.write("ustar\0", 257, 6, "utf8");
  h.write("00", 263, 2, "utf8");
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
  const data = Buffer.alloc(Math.ceil(Buffer.byteLength(body) / 512) * 512);
  data.write(body, 0, "utf8");
  return Buffer.concat([h, data]);
}

// GitHub's tarball opens with a pax_global_header entry and the repo's root directory
// before any file — both must be ignored when working out what prefix to strip.
function tarball(root: string, files: Record<string, string>): Buffer {
  const parts = [
    tarEntry("pax_global_header", "52 comment=227a021ef94ddfeda7bcbcc6fb80c948f40a43ae\n", "g"),
    tarEntry(`${root}/`, "", "5"),
    ...Object.entries(files).map(([p, b]) => tarEntry(`${root}/${p}`, b)),
  ];
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}

test("ghGetSnapshot returns every JSON file keyed by repo-relative path", async () => {
  const tgz = tarball("owner-repo-abc123", {
    "README.md": "not json",
    "data/run-status.json": JSON.stringify({ lastRun: "2026-08-25", perApp: { a: {} } }),
    "data/config.json": JSON.stringify({ apps: {} }),
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(tgz), { status: 200 })));
  const snap = await ghGetSnapshot(cfg);
  expect(snap.get("data/run-status.json")).toEqual({ lastRun: "2026-08-25", perApp: { a: {} } });
  expect(snap.get("data/config.json")).toEqual({ apps: {} });
  expect(snap.has("README.md")).toBe(false); // non-JSON is skipped
});

test("ghGetSnapshot reassembles paths that overflow TAR's 100-byte name field", async () => {
  // Real paths run to ~119 chars once GitHub's "owner-repo-<40-char-sha>/" root is prepended,
  // so the ustar prefix field carries the front of the path. Dropping it loses the file.
  const root = "lawoflarge-appstore-command-center-data-227a021ef94ddfeda7bcbcc6fb80c948f40a43ae";
  const long = "data/6767226388/analytics/2026-08.json";
  expect(`${root}/${long}`.length).toBeGreaterThan(100);
  const tgz = tarball(root, { [long]: JSON.stringify([{ day: "2026-08-01", downloads: 7 }]) });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(tgz), { status: 200 })));
  const snap = await ghGetSnapshot(cfg);
  expect(snap.get(long)).toEqual([{ day: "2026-08-01", downloads: 7 }]);
});

test("ghGetSnapshot throws on a failed tarball fetch", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
  await expect(ghGetSnapshot(cfg)).rejects.toThrow("GH TARBALL 403");
});

test("ghGetSnapshot ignores the pax_global_header when deriving the root prefix", async () => {
  // GitHub prepends a "pax_global_header" entry whose name has no directory part. Treating it
  // as the archive root strips 18 characters off every real path, so the snapshot silently
  // holds no path the app ever asks for and every page renders empty.
  const root = "lawoflarge-appstore-command-center-data-227a021ef94ddfeda7bcbcc6fb80c948f40a43ae";
  const tgz = tarball(root, { "data/run-status.json": JSON.stringify({ perApp: { a: {} } }) });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(tgz), { status: 200 })));
  const snap = await ghGetSnapshot(cfg);
  expect([...snap.keys()]).toEqual(["data/run-status.json"]);
});
