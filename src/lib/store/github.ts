export interface GhConfig { repo: string; token: string; branch: string; }

const API = "https://api.github.com";

function headers(cfg: GhConfig) {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function ghGetJson<T>(
  cfg: GhConfig, path: string,
): Promise<{ value: T; sha: string } | null> {
  const url = `${API}/repos/${cfg.repo}/contents/${path}?ref=${cfg.branch}`;
  const res = await fetch(url, { headers: headers(cfg), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GH GET ${res.status} ${path}: ${await res.text()}`);
  const json = (await res.json()) as { content: string; sha: string };
  const value = JSON.parse(
    Buffer.from(json.content, "base64").toString("utf8"),
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
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: "PUT", headers: headers(cfg), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GH PUT ${res.status} ${path}: ${await res.text()}`);
}
