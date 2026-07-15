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
