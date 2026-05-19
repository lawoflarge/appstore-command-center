import { gunzipSync } from "node:zlib";
import { signAscToken, type AscKey } from "./jwt";

const BASE = "https://api.appstoreconnect.apple.com";

function authHeaders(key: AscKey) {
  return { Authorization: `Bearer ${signAscToken(key)}` };
}

export async function ascGetJson<T = unknown>(key: AscKey, url: string): Promise<T> {
  const res = await fetch(url.startsWith("http") ? url : BASE + url, {
    headers: authHeaders(key),
  });
  if (!res.ok) throw new Error(`ASC ${res.status} ${url}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function ascGetAllPages(key: AscKey, url: string): Promise<any[]> {
  let next: string | undefined = url.startsWith("http") ? url : BASE + url;
  const out: any[] = [];
  while (next) {
    const page: any = await ascGetJson(key, next);
    out.push(...(page.data ?? []));
    next = page.links?.next;
  }
  return out;
}

export async function ascGetGzipTsv(
  key: AscKey, url: string,
): Promise<Record<string, string>[]> {
  const res = await fetch(url.startsWith("http") ? url : BASE + url, {
    headers: { ...authHeaders(key), Accept: "application/a-gzip" },
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`ASC ${res.status} ${url}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = gunzipSync(buf).toString("utf8");
  return parseTsv(text);
}

export function parseTsv(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: Record<string, string> = {};
    header.forEach((h, idx) => (row[h] = cells[idx] ?? ""));
    return row;
  });
}
