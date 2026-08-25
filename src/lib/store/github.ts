import { gunzipSync } from "node:zlib";

export interface GhConfig { repo: string; token: string; branch: string; }

const API = "https://api.github.com";

function headers(cfg: GhConfig) {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// GitHub error pages can be enormous (the 502 "Unicorn" HTML page is ~55 kB with an inline
// base64 image). Embedding one verbatim in an Error once ballooned run-status.json past the
// Contents-API 1 MB limit and took down every page. Keep thrown messages bounded.
const MAX_ERROR_BODY = 500;
async function errBody(res: Response): Promise<string> {
  const text = await res.text();
  if (text.length <= MAX_ERROR_BODY) return text;
  return `${text.slice(0, MAX_ERROR_BODY)}… [${text.length - MAX_ERROR_BODY} chars truncated]`;
}

export async function ghGetJson<T>(
  cfg: GhConfig, path: string,
): Promise<{ value: T; sha: string } | null> {
  const url = `${API}/repos/${cfg.repo}/contents/${path}?ref=${cfg.branch}`;
  const res = await fetch(url, { headers: headers(cfg), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GH GET ${res.status} ${path}: ${await errBody(res)}`);
  const json = (await res.json()) as { content: string; sha: string; size?: number };
  const clean = json.content.replace(/\s/g, "");
  // For files over 1 MB the Contents API returns content:"" with encoding:"none" — the
  // metadata (sha, size) is still there. Re-fetch the body via the raw media type.
  if (clean === "" && (json.size ?? 0) > 0) {
    const raw = await fetch(url, {
      headers: { ...headers(cfg), Accept: "application/vnd.github.raw" },
      cache: "no-store",
    });
    if (!raw.ok) throw new Error(`GH GET raw ${raw.status} ${path}: ${await errBody(raw)}`);
    return { value: JSON.parse(await raw.text()) as T, sha: json.sha };
  }
  const value = JSON.parse(
    Buffer.from(clean, "base64").toString("utf8"),
  ) as T;
  return { value, sha: json.sha };
}

export async function ghPutJson(
  cfg: GhConfig, path: string, value: unknown,
  sha: string | null, message: string,
): Promise<void> {
  const url = `${API}/repos/${cfg.repo}/contents/${path}`;
  const body: Record<string, unknown> = {
    message,
    branch: cfg.branch,
    content: Buffer.from(JSON.stringify(value, null, 2)).toString("base64"),
  };
  if (sha !== null) body.sha = sha;
  const res = await fetch(url, {
    method: "PUT", headers: headers(cfg), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GH PUT ${res.status} ${path}: ${await errBody(res)}`);
}

// One render of the dashboard reads ~700 small JSON files, and the Contents API bills one
// request per file — a handful of reloads exhausted GitHub's 5,000/hr quota, after which every
// read 403'd and the whole page threw (digest 192268049, 2026-08-25). The tarball endpoint
// returns the entire data repo in a single response; GitHub redirects it to codeload, which
// costs no API quota at all. The repo is ~90 kB gzipped, so this trades ~700 billed requests
// for one free one.
export async function ghGetSnapshot(cfg: GhConfig): Promise<Map<string, unknown>> {
  const res = await fetch(`${API}/repos/${cfg.repo}/tarball/${cfg.branch}`, {
    headers: headers(cfg), cache: "no-store",
  });
  if (!res.ok) throw new Error(`GH TARBALL ${res.status}: ${await errBody(res)}`);
  return parseJsonTar(gunzipSync(Buffer.from(await res.arrayBuffer())));
}

// TAR is a flat run of 512-byte header blocks, each followed by its file body padded to 512.
// Header fields used here: name at 0, octal size at 124, type at 156, and prefix at 345 —
// prefix matters because GitHub nests everything under "<owner>-<repo>-<40-char-sha>/", which
// pushes real paths past the 100-byte name field. That root is stripped so the keys match the
// paths in lib/store/paths.ts.
function parseJsonTar(buf: Buffer): Map<string, unknown> {
  const out = new Map<string, unknown>();
  let root: string | null = null;
  for (let off = 0; off + 512 <= buf.length; ) {
    const h = buf.subarray(off, off + 512);
    if (h[0] === 0) break; // the archive ends with zero-filled blocks
    const field = (start: number, len: number) =>
      h.subarray(start, start + len).toString("utf8").split("\0")[0];
    const prefix = field(345, 155);
    const name = field(0, 100);
    const full = prefix ? `${prefix}/${name}` : name;
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = h[156];
    // "g"/"x" are pax headers: archive metadata, not repo content. GitHub opens every tarball
    // with a "pax_global_header" entry whose name carries no directory, so mistaking it for the
    // root would strip 18 characters off every real path — leaving a snapshot that holds none
    // of the paths the app asks for and renders every page empty.
    const isPax = type === 0x67 || type === 0x78;
    const slash = full.indexOf("/");
    if (root === null && !isPax && slash > 0) root = full.slice(0, slash);
    // typeflag "0" (or NUL, which older writers emit) is a regular file.
    if (root !== null && (type === 0x30 || type === 0) && full.endsWith(".json")) {
      const text = buf.subarray(off + 512, off + 512 + size).toString("utf8");
      // A file that won't parse is left out of the snapshot, so its reader falls back exactly
      // as it would for a missing file rather than the bad file taking down every page.
      try { out.set(full.slice(root.length + 1), JSON.parse(text)); } catch {}
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
