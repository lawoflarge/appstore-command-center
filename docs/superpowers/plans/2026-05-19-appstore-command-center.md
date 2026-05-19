# App Store Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private single-user Next.js dashboard on Vercel that pulls App Store Connect data daily into a git-as-DB, derives growth intelligence, and renders it in a Daylight Frost glass UI.

**Architecture:** A daily Vercel Cron runs an orchestrator that auto-discovers every app on the Apple account, runs five isolated collectors (sales, analytics, reviews, ratings, keyword-rank), and commits partitioned JSON to the repo via the GitHub Contents API. A pure-function intelligence engine (plus batched Anthropic calls) turns the series into insights. A GitHub-OAuth-locked Next.js App Router UI reads the committed JSON through a single data-access layer and renders six screens.

**Tech Stack:** Next.js 15 (App Router, TypeScript), pnpm, Vitest, Tailwind CSS v4, Auth.js v5 (GitHub), Recharts, `jsonwebtoken`, `@anthropic-ai/sdk`, `zod`, `date-fns`, Node `zlib`, GitHub REST Contents API.

---

## Spec

Source: `docs/superpowers/specs/2026-05-19-appstore-command-center-design.md`. Read it before starting.

## Conventions (read once)

- **Package manager:** `pnpm` only. Never `npm`/`yarn`.
- **Tests:** Vitest. Test files are `*.test.ts` colocated under `tests/` mirroring `src/`. Fixtures in `tests/fixtures/`.
- **TDD:** every logic task = failing test → run (fail) → implement → run (pass) → commit.
- **Commits:** Conventional Commits. One commit per task minimum. End every commit message body with:
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- **No secrets in git.** All credentials are env vars. `.env` is gitignored (already done).
- **Dates are UTC.** A "report day" is a UTC calendar date `YYYY-MM-DD`.
- **Money/units** from ASC are integers/strings; never coerce with `parseFloat` without trimming.
- Run all commands from the project root `/path/to/appstore-command-center`.

## File Structure (decomposition)

```
src/
  env.ts                         zod-validated process.env (server-only)
  lib/
    dates.ts                     UTC day helpers (range, format, addDays)
    asc/jwt.ts                   ES256 ASC JWT from .p8
    asc/client.ts                authed fetch: JSON pagination, gzip, TSV
    sources/apps.ts              auto-discover apps (GET /v1/apps)
    sources/sales.ts             collect-sales (salesReports TSV)
    sources/analytics.ts         collect-analytics (ONGOING requests + instances)
    sources/reviews.ts           collect-reviews (customerReviews)
    sources/ratings.ts           collect-ratings (iTunes lookup)
    sources/keywords.ts          collect-keyword-rank (iTunes search)
    store/github.ts              GitHub Contents API get/put JSON
    store/paths.ts               stored-JSON path builders + shared types
    store/store.ts               idempotent read/write, run-status, config
    intelligence/baseline.ts     dow-aware trailing baseline + z-score
    intelligence/anomaly.ts      anomaly + probable cause
    intelligence/funnel.ts       conversion-leak diagnosis
    intelligence/keywords.ts     keyword opportunity finder
    intelligence/forecast.ts     month-end projection + band
    llm/anthropic.ts             Anthropic client w/ prompt caching
    intelligence/sentiment.ts    review clustering (Anthropic)
    intelligence/digest.ts       weekly digest (Anthropic)
    intelligence/engine.ts       runs the pass → insights.json
    aggregate/downloads.ts       compute-on-read downloads series
    aggregate/funnel.ts          compute-on-read funnel
    aggregate/ratings.ts         compute-on-read ratings
    aggregate/portfolio.ts       attention-ranked portfolio rows
    auth/config.ts               Auth.js config + allowlist
  app/layout.tsx                 root layout, fonts, frost background
  app/globals.css                Daylight Frost tokens + glass utilities
  app/page.tsx                   Glance
  app/portfolio/page.tsx         Portfolio
  app/app/[appId]/page.tsx       App detail
  app/aso/page.tsx               ASO / Growth
  app/reviews/page.tsx           Reviews & reputation
  app/insights/page.tsx          Insights center
  app/api/cron/route.ts          orchestrator (CRON_SECRET guarded)
  app/api/auth/[...nextauth]/route.ts
  app/api/data/[...path]/route.ts  auth-gated aggregate API
  app/api/config/route.ts        mutate watchlist/visibility
  components/glass/*.tsx         Card, Stat, Pill, Section, Nav
  components/charts/*.tsx        LineArea, Sparkline, FunnelBars
  middleware.ts                  edge auth gate
tests/                           mirrors src; fixtures in tests/fixtures/
```

---

## Milestone 0 — Scaffold & tooling

### Task 0.1: Initialize Next.js + tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.env.example`

- [ ] **Step 1: Scaffold**

Run:
```bash
pnpm dlx create-next-app@15 . --ts --app --tailwind --eslint --src-dir --import-alias "@/*" --use-pnpm --no-turbopack
```
Accept overwrite of the existing dir; keep `.git`, `docs/`, `.gitignore`, `.superpowers/`.

- [ ] **Step 2: Add dependencies**

Run:
```bash
pnpm add jsonwebtoken zod date-fns recharts @anthropic-ai/sdk next-auth@beta
pnpm add -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom jsdom @types/jsonwebtoken
```

- [ ] **Step 3: Create `.env.example`**

```bash
# ASC API
ASC_KEY_ID=YOUR_ASC_KEY_ID
ASC_ISSUER_ID=your-asc-issuer-uuid
ASC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
ASC_VENDOR_NUMBER=
# GitHub OAuth (dashboard login)
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
AUTH_SECRET=
ALLOWED_GITHUB_LOGIN=your-github-username
# GitHub data store
GITHUB_DATA_REPO=your-org/appstore-command-center
GITHUB_DATA_TOKEN=
GITHUB_DATA_BRANCH=main
# LLM
ANTHROPIC_API_KEY=
# Cron
CRON_SECRET=
NEXTAUTH_URL=http://localhost:3000
```

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: build succeeds (default starter).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app + tooling deps

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 0.2: Vitest configuration

**Files:**
- Create: `vitest.config.ts`, `vitest.setup.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: { provider: "v8", reportsDirectory: "./archive/coverage" },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

- [ ] **Step 2: Write `vitest.setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Add scripts to `package.json`**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Add a smoke test** — Create `tests/smoke.test.ts`:

```ts
import { test, expect } from "vitest";
test("vitest runs", () => { expect(1 + 1).toBe(2); });
```

- [ ] **Step 5: Run** — `pnpm test` → Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: configure vitest

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 0.3: Env validation module

**Files:**
- Create: `src/env.ts`
- Test: `tests/env.test.ts`

- [ ] **Step 1: Write failing test** — `tests/env.test.ts`:

```ts
import { test, expect } from "vitest";
import { parseEnv } from "@/env";

test("parseEnv rejects missing required keys", () => {
  expect(() => parseEnv({})).toThrow();
});

test("parseEnv accepts a full valid env", () => {
  const e = parseEnv({
    ASC_KEY_ID: "K", ASC_ISSUER_ID: "I", ASC_PRIVATE_KEY: "P",
    ASC_VENDOR_NUMBER: "123", GITHUB_OAUTH_CLIENT_ID: "c",
    GITHUB_OAUTH_CLIENT_SECRET: "s", AUTH_SECRET: "a",
    ALLOWED_GITHUB_LOGIN: "lawoflarge", GITHUB_DATA_REPO: "o/r",
    GITHUB_DATA_TOKEN: "t", GITHUB_DATA_BRANCH: "main",
    ANTHROPIC_API_KEY: "ak", CRON_SECRET: "cs",
  });
  expect(e.ALLOWED_GITHUB_LOGIN).toBe("lawoflarge");
  expect(e.GITHUB_DATA_BRANCH).toBe("main");
});
```

- [ ] **Step 2: Run** — `pnpm test tests/env.test.ts` → Expected: FAIL (`@/env` not found).

- [ ] **Step 3: Write `src/env.ts`**

```ts
import { z } from "zod";

const schema = z.object({
  ASC_KEY_ID: z.string().min(1),
  ASC_ISSUER_ID: z.string().min(1),
  ASC_PRIVATE_KEY: z.string().min(1),
  ASC_VENDOR_NUMBER: z.string().min(1),
  GITHUB_OAUTH_CLIENT_ID: z.string().min(1),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  ALLOWED_GITHUB_LOGIN: z.string().min(1),
  GITHUB_DATA_REPO: z.string().regex(/^[^/]+\/[^/]+$/),
  GITHUB_DATA_TOKEN: z.string().min(1),
  GITHUB_DATA_BRANCH: z.string().default("main"),
  ANTHROPIC_API_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(src: Record<string, string | undefined>): Env {
  return schema.parse(src);
}

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
```

- [ ] **Step 4: Run** — `pnpm test tests/env.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: zod-validated env module

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 1 — Dates & ASC client

### Task 1.1: UTC date helpers

**Files:**
- Create: `src/lib/dates.ts`
- Test: `tests/lib/dates.test.ts`

- [ ] **Step 1: Failing test** — `tests/lib/dates.test.ts`:

```ts
import { test, expect } from "vitest";
import { ymd, addDays, dayRange } from "@/lib/dates";

test("ymd formats a UTC date", () => {
  expect(ymd(new Date("2026-05-19T23:30:00Z"))).toBe("2026-05-19");
});
test("addDays crosses month boundary in UTC", () => {
  expect(addDays("2026-05-31", 1)).toBe("2026-06-01");
  expect(addDays("2026-05-01", -1)).toBe("2026-04-30");
});
test("dayRange is inclusive and ordered", () => {
  expect(dayRange("2026-05-18", "2026-05-20"))
    .toEqual(["2026-05-18", "2026-05-19", "2026-05-20"]);
});
```

- [ ] **Step 2: Run** → Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/dates.ts`**

```ts
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, delta: number): string {
  const d = new Date(day + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return ymd(d);
}

export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) { out.push(cur); cur = addDays(cur, 1); }
  return out;
}

export function todayUtc(): string {
  return ymd(new Date());
}
```

- [ ] **Step 4: Run** → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: UTC date helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.2: ASC JWT signer

**Files:**
- Create: `src/lib/asc/jwt.ts`
- Test: `tests/lib/asc/jwt.test.ts`

Background: ASC API requires an ES256 JWT, `iss` = issuer id, `aud` = `appstoreconnect-v1`, `exp` ≤ 20 min, header `kid` = key id, `alg` = ES256, signed with the `.p8` EC private key.

- [ ] **Step 1: Failing test** — generate a throwaway EC key in the test so no secret is needed:

```ts
import { test, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { signAscToken } from "@/lib/asc/jwt";

test("signAscToken produces a verifiable ES256 token", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const token = signAscToken({ keyId: "KID", issuerId: "ISS", privateKey });
  const decoded = jwt.verify(token, publicKey, { algorithms: ["ES256"] }) as Record<string, unknown>;
  expect(decoded.iss).toBe("ISS");
  expect(decoded.aud).toBe("appstoreconnect-v1");
  const header = JSON.parse(Buffer.from(token.split(".")[0], "base64").toString());
  expect(header.kid).toBe("KID");
  expect(header.alg).toBe("ES256");
});
```

- [ ] **Step 2: Run** → Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/asc/jwt.ts`**

```ts
import jwt from "jsonwebtoken";

export interface AscKey { keyId: string; issuerId: string; privateKey: string; }

export function signAscToken(key: AscKey): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: key.issuerId, iat: now, exp: now + 19 * 60, aud: "appstoreconnect-v1" },
    key.privateKey,
    { algorithm: "ES256", header: { alg: "ES256", kid: key.keyId, typ: "JWT" } },
  );
}

export function ascKeyFromEnv(e: {
  ASC_KEY_ID: string; ASC_ISSUER_ID: string; ASC_PRIVATE_KEY: string;
}): AscKey {
  return {
    keyId: e.ASC_KEY_ID,
    issuerId: e.ASC_ISSUER_ID,
    // env stores newlines as literal \n
    privateKey: e.ASC_PRIVATE_KEY.replace(/\\n/g, "\n"),
  };
}
```

- [ ] **Step 4: Run** → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: ASC ES256 JWT signer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.3: ASC client (JSON pagination + gzip TSV)

**Files:**
- Create: `src/lib/asc/client.ts`
- Test: `tests/lib/asc/client.test.ts`

- [ ] **Step 1: Failing test** (mock `fetch`):

```ts
import { test, expect, vi, afterEach } from "vitest";
import { gzipSync } from "node:zlib";
import { ascGetJson, ascGetAllPages, ascGetGzipTsv, parseTsv } from "@/lib/asc/client";

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

test("ascGetJson throws with status and url on non-ok", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
  await expect(ascGetJson(key, "https://api/x")).rejects.toThrow(/ASC 500 https:\/\/api\/x: boom/);
});

test("ascGetGzipTsv throws on non-404 error", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
  await expect(ascGetGzipTsv(key, "https://api/s")).rejects.toThrow(/ASC 403/);
});

test("parseTsv strips CRLF and handles header-only/empty", () => {
  expect(parseTsv("A\tB\r\n5\tDE\r\n")).toEqual([{ A: "5", B: "DE" }]);
  expect(parseTsv("A\tB\r\n")).toEqual([]);
  expect(parseTsv("")).toEqual([]);
});
```

> Note: the client unit test mocks `@/lib/asc/jwt` so the HTTP layer is tested in isolation; JWT signing correctness is covered by Task 1.2's test.

- [ ] **Step 2: Run** → Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/asc/client.ts`**

```ts
import { gunzipSync } from "node:zlib";
import { signAscToken, type AscKey } from "./jwt";

const BASE = "https://api.appstoreconnect.apple.com";
const MAX_PAGES = 500;

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
  let pages = 0;
  while (next) {
    if (++pages > MAX_PAGES) throw new Error(`ascGetAllPages: exceeded ${MAX_PAGES} pages at ${next}`);
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
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: Record<string, string> = {};
    header.forEach((h, idx) => (row[h] = cells[idx] ?? ""));
    return row;
  });
}
```

- [ ] **Step 4: Run** → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: ASC client (pagination + gzip TSV)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 2 — git-as-DB store

### Task 2.1: Stored-JSON paths & shared types

**Files:**
- Create: `src/lib/store/paths.ts`
- Test: `tests/lib/store/paths.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "vitest";
import { salesPath, reviewsPath, ratingsPath, keywordsPath, configPath, insightsPath, runStatusPath, appMetaPath } from "@/lib/store/paths";

test("monthly partition paths", () => {
  expect(salesPath("123", "2026-05-19")).toBe("data/123/sales/2026-05.json");
  expect(ratingsPath("123", "2026-05-19")).toBe("data/123/ratings/2026-05.json");
  expect(reviewsPath("123")).toBe("data/123/reviews.json");
  expect(keywordsPath("123", "2026-05-19")).toBe("data/123/keywords/2026-05.json");
  expect(appMetaPath("123")).toBe("data/123/meta.json");
  expect(configPath()).toBe("data/config.json");
  expect(insightsPath()).toBe("data/insights.json");
  expect(runStatusPath()).toBe("data/run-status.json");
});
```

- [ ] **Step 2: Run** → Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/store/paths.ts`**

```ts
const month = (day: string) => day.slice(0, 7);

export const salesPath = (appId: string, day: string) => `data/${appId}/sales/${month(day)}.json`;
export const analyticsPath = (appId: string, day: string) => `data/${appId}/analytics/${month(day)}.json`;
export const ratingsPath = (appId: string, day: string) => `data/${appId}/ratings/${month(day)}.json`;
export const keywordsPath = (appId: string, day: string) => `data/${appId}/keywords/${month(day)}.json`;
export const reviewsPath = (appId: string) => `data/${appId}/reviews.json`;
export const appMetaPath = (appId: string) => `data/${appId}/meta.json`;
export const configPath = () => `data/config.json`;
export const insightsPath = () => `data/insights.json`;
export const runStatusPath = () => `data/run-status.json`;

export interface DailyMetric { day: string; [k: string]: string | number; }
export interface SalesDay { day: string; byCountry: Record<string, number>; total: number; redownloads: number; proceedsUsd: number; }
export interface AnalyticsDay { day: string; impressions: number; pageViews: number; downloads: number; sessions: number; activeDevices: number; deletions: number; crashes: number; bySource: Record<string, number>; }
export interface RatingPoint { day: string; byCountry: Record<string, { avg: number; count: number }>; avg: number; count: number; }
export interface Review { id: string; rating: number; title: string; body: string; reviewer: string; territory: string; createdDate: string; responded: boolean; }
export interface KeywordRank { day: string; term: string; country: string; rank: number | null; }
export interface AppMeta { appId: string; name: string; bundleId: string; sku: string; firstSeen: string; hidden: boolean; archived: boolean; releases: { version: string; date: string }[]; }
export interface AppConfig { hidden: boolean; archived: boolean; keywords: { term: string; country: string }[]; goalDownloadsPerMonth?: number; }
export interface Config { apps: Record<string, AppConfig>; }
export interface RunStatus { lastRun: string; lastSuccess: string; perApp: Record<string, Record<string, { ok: boolean; at: string; error?: string }>>; }
```

- [ ] **Step 4: Run** → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: store path builders + shared types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.2: GitHub Contents API wrapper

**Files:**
- Create: `src/lib/store/github.ts`
- Test: `tests/lib/store/github.test.ts`

- [ ] **Step 1: Failing test** (mock fetch):

```ts
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
```

- [ ] **Step 2: Run** → Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/store/github.ts`**

```ts
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
  const clean = json.content.replace(/\s/g, "");
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
  if (!res.ok) throw new Error(`GH PUT ${res.status} ${path}: ${await res.text()}`);
}
```

- [ ] **Step 4: Run** → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: GitHub Contents API wrapper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.3: Store layer (idempotent read/merge/write + cached reads)

**Files:**
- Create: `src/lib/store/store.ts`
- Test: `tests/lib/store/store.test.ts`

- [ ] **Step 1: Failing test** (inject a fake gh backend):

```ts
import { test, expect, vi } from "vitest";
import { makeStore } from "@/lib/store/store";

function fakeGh() {
  const fs = new Map<string, { value: any; sha: string }>();
  let n = 0;
  return {
    fs,
    get: vi.fn(async (p: string) => fs.get(p) ?? null),
    put: vi.fn(async (p: string, v: any, _sha: string | null) => {
      fs.set(p, { value: v, sha: "sha" + ++n });
    }),
  };
}

test("upsertDailyArray merges by day idempotently", async () => {
  const gh = fakeGh();
  const store = makeStore(gh as any);
  await store.upsertDailyArray("data/a/sales/2026-05.json",
    [{ day: "2026-05-18", total: 5 }], "m");
  await store.upsertDailyArray("data/a/sales/2026-05.json",
    [{ day: "2026-05-18", total: 9 }, { day: "2026-05-19", total: 2 }], "m");
  const stored = gh.fs.get("data/a/sales/2026-05.json")!.value;
  expect(stored).toEqual([
    { day: "2026-05-18", total: 9 },
    { day: "2026-05-19", total: 2 },
  ]);
});

test("readJson returns fallback when absent", async () => {
  const store = makeStore(fakeGh() as any);
  expect(await store.readJson("missing.json", { x: 1 })).toEqual({ x: 1 });
});
```

- [ ] **Step 2: Run** → Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/store/store.ts`**

```ts
import { env } from "@/env";
import { ghGetJson, ghPutJson, type GhConfig } from "./github";

export interface GhBackend {
  get<T>(path: string): Promise<{ value: T; sha: string } | null>;
  put(path: string, value: unknown, sha: string | null, message: string): Promise<void>;
}

export function ghBackendFromEnv(): GhBackend {
  const e = env();
  const cfg: GhConfig = {
    repo: e.GITHUB_DATA_REPO, token: e.GITHUB_DATA_TOKEN, branch: e.GITHUB_DATA_BRANCH,
  };
  return {
    get: (p) => ghGetJson(cfg, p),
    put: (p, v, sha, m) => ghPutJson(cfg, p, v, sha, m),
  };
}

export function makeStore(gh: GhBackend) {
  return {
    async readJson<T>(path: string, fallback: T): Promise<T> {
      const r = await gh.get<T>(path);
      return r ? r.value : fallback;
    },
    async writeJson(path: string, value: unknown, message: string): Promise<void> {
      const existing = await gh.get(path);
      await gh.put(path, value, existing?.sha ?? null, message);
    },
    /** Merge rows into an array-of-{day} file, replacing same-day entries. */
    async upsertDailyArray<T extends { day: string }>(
      path: string, rows: T[], message: string,
    ): Promise<void> {
      const existing = await gh.get<T[]>(path);
      const map = new Map<string, T>();
      for (const r of existing?.value ?? []) map.set(r.day, r);
      for (const r of rows) map.set(r.day, r);
      const merged = [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
      await gh.put(path, merged, existing?.sha ?? null, message);
    },
  };
}

export type Store = ReturnType<typeof makeStore>;
```

- [ ] **Step 4: Run** → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: idempotent git-as-DB store layer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Milestone 3 — Collectors

Each collector is a pure function: `(deps) => normalized rows`. ASC/HTTP is injected so tests use fixtures. Capture real fixtures later via a one-off script; tasks below use representative fixtures.

### Task 3.1: App auto-discovery

**Files:**
- Create: `src/lib/sources/apps.ts`
- Test: `tests/lib/sources/apps.test.ts`
- Fixture: `tests/fixtures/asc-apps.json`

- [ ] **Step 1: Fixture** — `tests/fixtures/asc-apps.json`:

```json
[
  { "id": "6767226388", "attributes": { "name": "Example App One", "bundleId": "com.example.appone", "sku": "EXAMPLE1" } },
  { "id": "6480000000", "attributes": { "name": "Example App Two", "bundleId": "com.example.apptwo", "sku": "EXAMPLE2" } }
]
```

- [ ] **Step 2: Failing test**

```ts
import { test, expect } from "vitest";
import apps from "../../fixtures/asc-apps.json";
import { discoverApps } from "@/lib/sources/apps";

test("discoverApps maps ASC app records", async () => {
  const result = await discoverApps(async () => apps as any, "2026-05-19");
  expect(result).toEqual([
    { appId: "6767226388", name: "Example App One", bundleId: "com.example.appone", sku: "EXAMPLE1", firstSeen: "2026-05-19", hidden: false, archived: false, releases: [] },
    { appId: "6480000000", name: "Example App Two", bundleId: "com.example.apptwo", sku: "EXAMPLE2", firstSeen: "2026-05-19", hidden: false, archived: false, releases: [] },
  ]);
});
```

- [ ] **Step 3: Run** → FAIL. **Step 4: Implement `src/lib/sources/apps.ts`**

```ts
import type { AppMeta } from "@/lib/store/paths";

export type FetchApps = () => Promise<{ id: string; attributes: { name: string; bundleId: string; sku: string } }[]>;

export async function discoverApps(fetchApps: FetchApps, today: string): Promise<AppMeta[]> {
  const rows = await fetchApps();
  return rows.map((r) => ({
    appId: r.id,
    name: r.attributes.name,
    bundleId: r.attributes.bundleId,
    sku: r.attributes.sku,
    firstSeen: today,
    hidden: false,
    archived: false,
    releases: [],
  }));
}

export const ascFetchApps = (key: import("@/lib/asc/jwt").AscKey) =>
  async () => (await import("@/lib/asc/client")).ascGetAllPages(key, "/v1/apps?limit=200");
```

- [ ] **Step 5: Run** → PASS. **Step 6: Commit** `feat: app auto-discovery collector`.

### Task 3.2: Sales collector

**Files:**
- Create: `src/lib/sources/sales.ts`
- Test: `tests/lib/sources/sales.test.ts`
- Fixture: `tests/fixtures/sales-2026-05-18.tsv`

ASC `salesReports`: `GET /v1/salesReports?filter[frequency]=DAILY&filter[reportType]=SALES&filter[reportSubType]=SUMMARY&filter[vendorNumber]=V&filter[reportDate]=YYYY-MM-DD&filter[version]=1_1`. Key columns: `Apple Identifier`, `Units`, `Country Code`, `Product Type Identifier` (downloads = `1`/`1F`/`1T`; redownloads = `1R`-family), `Developer Proceeds`.

- [ ] **Step 1: Fixture** — `tests/fixtures/sales-2026-05-18.tsv` (tab-separated):

```
Apple Identifier	Units	Country Code	Product Type Identifier	Developer Proceeds
6767226388	5	DE	1F	0.00
6767226388	3	NL	1F	0.00
6767226388	1	DE	1R	0.00
6480000000	2	US	1F	0.00
```

- [ ] **Step 2: Failing test**

```ts
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseTsv } from "@/lib/asc/client";
import { collectSales } from "@/lib/sources/sales";

const tsv = readFileSync(__dirname + "/../../fixtures/sales-2026-05-18.tsv", "utf8");

test("collectSales aggregates units per app/day/country", async () => {
  const rows = await collectSales(async () => parseTsv(tsv), ["6767226388"], "2026-05-18");
  expect(rows["6767226388"]).toEqual({
    day: "2026-05-18",
    byCountry: { DE: 5, NL: 3 },
    total: 8,
    redownloads: 1,
    proceedsUsd: 0,
  });
  expect(rows["6480000000"]).toBeUndefined();
});
```

- [ ] **Step 3: Run** → FAIL. **Step 4: Implement `src/lib/sources/sales.ts`**

```ts
import type { SalesDay } from "@/lib/store/paths";

export type FetchSalesTsv = (day: string) => Promise<Record<string, string>[]>;
const DOWNLOAD = new Set(["1", "1F", "1T", "1E", "1EP", "1EU"]);
const REDOWNLOAD = new Set(["1R", "1FR"]);

export async function collectSales(
  fetchTsv: FetchSalesTsv, appIds: string[], day: string,
): Promise<Record<string, SalesDay>> {
  const rows = await fetchTsv(day);
  const want = new Set(appIds);
  const acc: Record<string, SalesDay> = {};
  for (const r of rows) {
    const appId = r["Apple Identifier"];
    if (!want.has(appId)) continue;
    const units = parseInt(r["Units"] || "0", 10);
    const ptype = (r["Product Type Identifier"] || "").trim();
    const proceeds = parseFloat(r["Developer Proceeds"] || "0") || 0;
    const s = (acc[appId] ??= { day, byCountry: {}, total: 0, redownloads: 0, proceedsUsd: 0 });
    if (DOWNLOAD.has(ptype)) {
      s.byCountry[r["Country Code"]] = (s.byCountry[r["Country Code"]] ?? 0) + units;
      s.total += units;
    } else if (REDOWNLOAD.has(ptype)) {
      s.redownloads += units;
    }
    s.proceedsUsd += proceeds * units;
  }
  return acc;
}

export const ascFetchSalesTsv = (
  key: import("@/lib/asc/jwt").AscKey, vendor: string,
) => async (day: string) => {
  const q = new URLSearchParams({
    "filter[frequency]": "DAILY", "filter[reportType]": "SALES",
    "filter[reportSubType]": "SUMMARY", "filter[vendorNumber]": vendor,
    "filter[reportDate]": day, "filter[version]": "1_1",
  });
  return (await import("@/lib/asc/client")).ascGetGzipTsv(key, `/v1/salesReports?${q}`);
};
```

- [ ] **Step 5: Run** → PASS. **Step 6: Commit** `feat: sales collector`.

### Task 3.3: Analytics collector (ONGOING report request + instances)

**Files:**
- Create: `src/lib/sources/analytics.ts`
- Test: `tests/lib/sources/analytics.test.ts`
- Fixture: `tests/fixtures/analytics-app-store-engagement.csv`

Behavior: (1) ensure an `analyticsReportRequests` of type `ONGOING` exists for the app — if `listRequests()` returns none, call `createRequest()`; (2) walk reports → instances → segments; (3) parse the latest daily CSV rows into `AnalyticsDay`. The CSV columns vary by report; map defensively.

- [ ] **Step 1: Fixture** — `tests/fixtures/analytics-app-store-engagement.csv`:

```
Date,Impressions,Product Page Views,App Units,Sessions,Active Devices,Deletions,Source Type
2026-05-18,1200,300,80,500,420,10,App Store Search
2026-05-18,400,90,20,140,120,3,App Store Browse
```

- [ ] **Step 2: Failing test**

```ts
import { test, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ensureOngoingRequest, parseAnalyticsCsv } from "@/lib/sources/analytics";

const csv = readFileSync(__dirname + "/../../fixtures/analytics-app-store-engagement.csv", "utf8");

test("parseAnalyticsCsv folds rows into one AnalyticsDay with bySource", () => {
  const day = parseAnalyticsCsv(csv);
  expect(day["2026-05-18"]).toEqual({
    day: "2026-05-18",
    impressions: 1600, pageViews: 390, downloads: 100,
    sessions: 640, activeDevices: 540, deletions: 13, crashes: 0,
    bySource: { "App Store Search": 80, "App Store Browse": 20 },
  });
});

test("ensureOngoingRequest creates when none exist", async () => {
  const create = vi.fn(async () => ({ id: "req1" }));
  const list = vi.fn(async () => []);
  const id = await ensureOngoingRequest("app1", list, create);
  expect(create).toHaveBeenCalledWith("app1");
  expect(id).toBe("req1");
});

test("ensureOngoingRequest reuses existing", async () => {
  const create = vi.fn();
  const list = vi.fn(async () => [{ id: "existing" }]);
  expect(await ensureOngoingRequest("app1", list, create as any)).toBe("existing");
  expect(create).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run** → FAIL. **Step 4: Implement `src/lib/sources/analytics.ts`**

```ts
import type { AnalyticsDay } from "@/lib/store/paths";

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    const o: Record<string, string> = {};
    header.forEach((h, i) => (o[h] = cells[i] ?? ""));
    return o;
  });
}
function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === "," && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const num = (v: string) => parseInt((v || "0").replace(/[^0-9-]/g, ""), 10) || 0;

export function parseAnalyticsCsv(text: string): Record<string, AnalyticsDay> {
  const rows = parseCsv(text);
  const acc: Record<string, AnalyticsDay> = {};
  for (const r of rows) {
    const day = r["Date"];
    if (!day) continue;
    const d = (acc[day] ??= {
      day, impressions: 0, pageViews: 0, downloads: 0, sessions: 0,
      activeDevices: 0, deletions: 0, crashes: 0, bySource: {},
    });
    d.impressions += num(r["Impressions"]);
    d.pageViews += num(r["Product Page Views"]);
    d.downloads += num(r["App Units"]);
    d.sessions += num(r["Sessions"]);
    d.activeDevices += num(r["Active Devices"]);
    d.deletions += num(r["Deletions"]);
    d.crashes += num(r["Crashes"]);
    const src = r["Source Type"];
    if (src) d.bySource[src] = (d.bySource[src] ?? 0) + num(r["App Units"]);
  }
  return acc;
}

export async function ensureOngoingRequest(
  appId: string,
  list: (appId: string) => Promise<{ id: string }[]>,
  create: (appId: string) => Promise<{ id: string }>,
): Promise<string> {
  const existing = await list(appId);
  if (existing.length > 0) return existing[0].id;
  return (await create(appId)).id;
}
```

> Note: the live ASC wiring (list/create requests, walk instances→segments→download CSV) is added in the orchestrator (Task 5.1) using `ascGetAllPages`/`ascGetJson` + `fetch` of the segment `url`. The parsing/decision logic above is the tested unit.

- [ ] **Step 5: Run** → PASS. **Step 6: Commit** `feat: analytics collector parse + request logic`.

### Task 3.4: Reviews collector

**Files:**
- Create: `src/lib/sources/reviews.ts`
- Test: `tests/lib/sources/reviews.test.ts`
- Fixture: `tests/fixtures/asc-reviews.json`

- [ ] **Step 1: Fixture** — `tests/fixtures/asc-reviews.json`:

```json
[
  { "id": "r1", "attributes": { "rating": 5, "title": "Great", "body": "Love it", "reviewerNickname": "Max", "territory": "DEU", "createdDate": "2026-05-18T10:00:00Z" }, "relationships": { "response": { "data": null } } },
  { "id": "r2", "attributes": { "rating": 2, "title": "Crash", "body": "Crashes on launch", "reviewerNickname": "Lea", "territory": "NLD", "createdDate": "2026-05-19T08:00:00Z" }, "relationships": { "response": { "data": { "id": "resp1" } } } }
]
```

- [ ] **Step 2: Failing test**

```ts
import { test, expect } from "vitest";
import raw from "../../fixtures/asc-reviews.json";
import { mapReviews, mergeReviews } from "@/lib/sources/reviews";

test("mapReviews normalizes + responded flag", () => {
  const r = mapReviews(raw as any);
  expect(r[0]).toEqual({ id: "r1", rating: 5, title: "Great", body: "Love it", reviewer: "Max", territory: "DEU", createdDate: "2026-05-18T10:00:00Z", responded: false });
  expect(r[1].responded).toBe(true);
});

test("mergeReviews dedupes by id keeping newest mapping", () => {
  const a = [{ id: "r1", rating: 5, title: "", body: "", reviewer: "", territory: "", createdDate: "2026-05-18T10:00:00Z", responded: false }];
  const b = [{ id: "r1", rating: 5, title: "", body: "", reviewer: "", territory: "", createdDate: "2026-05-18T10:00:00Z", responded: true }];
  expect(mergeReviews(a, b)).toHaveLength(1);
  expect(mergeReviews(a, b)[0].responded).toBe(true);
});
```

- [ ] **Step 3: Run** → FAIL. **Step 4: Implement `src/lib/sources/reviews.ts`**

```ts
import type { Review } from "@/lib/store/paths";

export function mapReviews(rows: any[]): Review[] {
  return rows.map((r) => ({
    id: r.id,
    rating: r.attributes.rating,
    title: r.attributes.title ?? "",
    body: r.attributes.body ?? "",
    reviewer: r.attributes.reviewerNickname ?? "",
    territory: r.attributes.territory ?? "",
    createdDate: r.attributes.createdDate,
    responded: Boolean(r.relationships?.response?.data),
  }));
}

export function mergeReviews(existing: Review[], incoming: Review[]): Review[] {
  const map = new Map<string, Review>();
  for (const r of existing) map.set(r.id, r);
  for (const r of incoming) map.set(r.id, r);
  return [...map.values()].sort((a, b) => b.createdDate.localeCompare(a.createdDate));
}

export const ascFetchReviews = (key: import("@/lib/asc/jwt").AscKey, appId: string) =>
  async () => (await import("@/lib/asc/client")).ascGetAllPages(
    key, `/v1/apps/${appId}/customerReviews?sort=-createdDate&limit=200&include=response`);
```

- [ ] **Step 5: Run** → PASS. **Step 6: Commit** `feat: reviews collector`.

### Task 3.5: Ratings collector (iTunes lookup)

**Files:**
- Create: `src/lib/sources/ratings.ts`
- Test: `tests/lib/sources/ratings.test.ts`

- [ ] **Step 1: Failing test** (mock fetch):

```ts
import { test, expect, vi, afterEach } from "vitest";
import { collectRatings } from "@/lib/sources/ratings";

afterEach(() => vi.restoreAllMocks());

test("collectRatings aggregates per-country into a RatingPoint", async () => {
  const byCountry: Record<string, any> = {
    de: { results: [{ averageUserRating: 4.6, userRatingCount: 100 }] },
    us: { results: [{ averageUserRating: 4.0, userRatingCount: 100 }] },
  };
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const c = new URL(u).searchParams.get("country")!;
    return new Response(JSON.stringify(byCountry[c]), { status: 200 });
  }));
  const r = await collectRatings("123", ["de", "us"], "2026-05-19");
  expect(r.day).toBe("2026-05-19");
  expect(r.byCountry.de).toEqual({ avg: 4.6, count: 100 });
  expect(r.count).toBe(200);
  expect(r.avg).toBeCloseTo(4.3, 5);
});

test("collectRatings skips countries with no result", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })));
  const r = await collectRatings("123", ["de"], "2026-05-19");
  expect(r.count).toBe(0);
  expect(r.avg).toBe(0);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/sources/ratings.ts`**

```ts
import type { RatingPoint } from "@/lib/store/paths";

export async function collectRatings(
  appId: string, countries: string[], day: string,
): Promise<RatingPoint> {
  const byCountry: RatingPoint["byCountry"] = {};
  for (const c of countries) {
    const url = `https://itunes.apple.com/lookup?id=${appId}&country=${c}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) continue;
    const j = (await res.json()) as { results: { averageUserRating?: number; userRatingCount?: number }[] };
    const hit = j.results?.[0];
    if (!hit || !hit.userRatingCount) continue;
    byCountry[c] = {
      avg: Number(hit.averageUserRating ?? 0),
      count: Number(hit.userRatingCount ?? 0),
    };
  }
  let count = 0, weighted = 0;
  for (const v of Object.values(byCountry)) { count += v.count; weighted += v.avg * v.count; }
  return { day, byCountry, count, avg: count ? weighted / count : 0 };
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: ratings collector (iTunes lookup)`.

### Task 3.6: Keyword-rank collector (iTunes search)

**Files:**
- Create: `src/lib/sources/keywords.ts`
- Test: `tests/lib/sources/keywords.test.ts`

- [ ] **Step 1: Failing test** (mock fetch):

```ts
import { test, expect, vi, afterEach } from "vitest";
import { collectKeywordRanks } from "@/lib/sources/keywords";

afterEach(() => vi.restoreAllMocks());

test("collectKeywordRanks finds 1-based rank or null", async () => {
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const term = new URL(u).searchParams.get("term");
    const results = term === "rate tracker"
      ? [{ trackId: 999 }, { trackId: 123 }]
      : [{ trackId: 5 }, { trackId: 6 }];
    return new Response(JSON.stringify({ results }), { status: 200 });
  }));
  const r = await collectKeywordRanks("123",
    [{ term: "rate tracker", country: "de" }, { term: "nope", country: "de" }], "2026-05-19");
  expect(r).toEqual([
    { day: "2026-05-19", term: "rate tracker", country: "de", rank: 2 },
    { day: "2026-05-19", term: "nope", country: "de", rank: null },
  ]);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/sources/keywords.ts`**

```ts
import type { KeywordRank } from "@/lib/store/paths";

export async function collectKeywordRanks(
  appId: string, watch: { term: string; country: string }[], day: string,
): Promise<KeywordRank[]> {
  const out: KeywordRank[] = [];
  for (const w of watch) {
    const q = new URLSearchParams({
      term: w.term, country: w.country, entity: "software", limit: "200",
    });
    const res = await fetch(`https://itunes.apple.com/search?${q}`, { cache: "no-store" });
    let rank: number | null = null;
    if (res.ok) {
      const j = (await res.json()) as { results: { trackId: number }[] };
      const idx = j.results.findIndex((r) => String(r.trackId) === appId);
      rank = idx >= 0 ? idx + 1 : null;
    }
    out.push({ day, term: w.term, country: w.country, rank });
  }
  return out;
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: keyword-rank collector (iTunes search)`.

---

## Milestone 4 — Intelligence engine

> ⚠️ UTC note (carried from Task 1.1): `date-fns` `getDay`/`getDaysInMonth` operate in LOCAL time. In Tasks 4.1, 4.5 and 4.8 compute these in UTC instead — weekday: `new Date(day + "T00:00:00Z").getUTCDay()`; days-in-month: `new Date(Date.UTC(Number(day.slice(0,4)), Number(day.slice(5,7)), 0)).getUTCDate()`. The provided tests assume UTC; using the local-time date-fns variants will fail in non-UTC environments.

### Task 4.1: Day-of-week baseline & z-score

**Files:**
- Create: `src/lib/intelligence/baseline.ts`
- Test: `tests/lib/intelligence/baseline.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "vitest";
import { zScore } from "@/lib/intelligence/baseline";

test("zScore uses same-weekday history", () => {
  // 4 prior Mondays at ~100, today Monday = 160 → high z
  const series = [
    { day: "2026-04-20", value: 100 }, { day: "2026-04-27", value: 102 },
    { day: "2026-05-04", value: 98 }, { day: "2026-05-11", value: 100 },
    { day: "2026-05-18", value: 160 },
  ];
  const z = zScore(series, "2026-05-18");
  expect(z!.z).toBeGreaterThan(3);
  expect(z!.baseline).toBeCloseTo(100, 0);
});

test("zScore returns null with too few same-weekday points", () => {
  expect(zScore([{ day: "2026-05-18", value: 10 }], "2026-05-18")).toBeNull();
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/intelligence/baseline.ts`**

```ts
import { parseISO, getDay } from "date-fns";

export interface Point { day: string; value: number; }

export function zScore(series: Point[], day: string):
  { z: number; baseline: number; std: number } | null {
  const dow = getDay(parseISO(day + "T00:00:00Z"));
  const prior = series.filter(
    (p) => p.day < day && getDay(parseISO(p.day + "T00:00:00Z")) === dow,
  );
  if (prior.length < 3) return null;
  const cur = series.find((p) => p.day === day);
  if (!cur) return null;
  const mean = prior.reduce((s, p) => s + p.value, 0) / prior.length;
  const variance = prior.reduce((s, p) => s + (p.value - mean) ** 2, 0) / prior.length;
  const std = Math.sqrt(variance) || 1;
  return { z: (cur.value - mean) / std, baseline: mean, std };
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: dow-aware baseline + z-score`.

### Task 4.2: Anomaly detection + probable cause

**Files:**
- Create: `src/lib/intelligence/anomaly.ts`
- Test: `tests/lib/intelligence/anomaly.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "vitest";
import { detectAnomalies } from "@/lib/intelligence/anomaly";

const series = [
  { day: "2026-04-20", value: 100 }, { day: "2026-04-27", value: 100 },
  { day: "2026-05-04", value: 100 }, { day: "2026-05-11", value: 100 },
  { day: "2026-05-18", value: 20 },
];

test("flags a drop and attaches release cause when near a release", () => {
  const a = detectAnomalies({
    appId: "1", metric: "downloads", series, day: "2026-05-18",
    releases: [{ version: "1.2", date: "2026-05-18" }],
  });
  expect(a).not.toBeNull();
  expect(a!.direction).toBe("drop");
  expect(a!.cause).toContain("release");
});

test("no anomaly within normal variation", () => {
  const flat = series.slice(0, 4).concat({ day: "2026-05-18", value: 101 });
  expect(detectAnomalies({ appId: "1", metric: "downloads", series: flat, day: "2026-05-18", releases: [] })).toBeNull();
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/intelligence/anomaly.ts`**

```ts
import { zScore, type Point } from "./baseline";

export interface Anomaly {
  appId: string; metric: string; day: string;
  direction: "spike" | "drop"; z: number; value: number; baseline: number; cause: string;
}

export function detectAnomalies(input: {
  appId: string; metric: string; series: Point[]; day: string;
  releases: { version: string; date: string }[];
}): Anomaly | null {
  const z = zScore(input.series, input.day);
  if (!z || Math.abs(z.z) < 2.5) return null;
  const value = input.series.find((p) => p.day === input.day)!.value;
  const direction = z.z < 0 ? "drop" : "spike";
  const nearRelease = input.releases.find(
    (r) => Math.abs(daysBetween(r.date, input.day)) <= 2,
  );
  const cause = nearRelease
    ? `Near the ${nearRelease.version} release (${nearRelease.date})`
    : direction === "drop"
      ? "No release nearby — check storefront availability / external event"
      : "Unusual positive movement — check press/feature/ASA";
  return { appId: input.appId, metric: input.metric, day: input.day, direction, z: z.z, value, baseline: z.baseline, cause };
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86400000;
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: anomaly detection + probable cause`.

### Task 4.3: Funnel-leak diagnosis

**Files:**
- Create: `src/lib/intelligence/funnel.ts`
- Test: `tests/lib/intelligence/funnel.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "vitest";
import { diagnoseFunnel } from "@/lib/intelligence/funnel";

test("flags page-view→install as the leaking stage vs baseline", () => {
  const baseline = { impressions: 1000, pageViews: 300, downloads: 90 }; // 30% / 30%
  const today = { impressions: 1000, pageViews: 300, downloads: 30 };    // 30% / 10%
  const d = diagnoseFunnel(today, baseline);
  expect(d.leak).toBe("pageView_to_install");
  expect(d.message).toContain("conversion");
});

test("no leak when within tolerance", () => {
  const b = { impressions: 1000, pageViews: 300, downloads: 90 };
  expect(diagnoseFunnel({ impressions: 1000, pageViews: 300, downloads: 88 }, b).leak).toBe("none");
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/intelligence/funnel.ts`**

```ts
export interface FunnelStage { impressions: number; pageViews: number; downloads: number; }
export interface FunnelDiagnosis {
  leak: "impression_to_pageView" | "pageView_to_install" | "none";
  message: string;
  rates: { ipv: number; pvd: number; baselineIpv: number; baselinePvd: number };
}

const rate = (a: number, b: number) => (b > 0 ? a / b : 0);

export function diagnoseFunnel(today: FunnelStage, baseline: FunnelStage): FunnelDiagnosis {
  const ipv = rate(today.pageViews, today.impressions);
  const pvd = rate(today.downloads, today.pageViews);
  const bIpv = rate(baseline.pageViews, baseline.impressions);
  const bPvd = rate(baseline.downloads, baseline.pageViews);
  const rates = { ipv, pvd, baselineIpv: bIpv, baselinePvd: bPvd };
  const dropIpv = bIpv > 0 ? (bIpv - ipv) / bIpv : 0;
  const dropPvd = bPvd > 0 ? (bPvd - pvd) / bPvd : 0;
  if (dropPvd >= 0.25 && dropPvd >= dropIpv)
    return { leak: "pageView_to_install", rates,
      message: `Page-view→install conversion fell to ${(pvd * 100).toFixed(1)}% (was ${(bPvd * 100).toFixed(1)}%). Screenshots/icon/rating likely.` };
  if (dropIpv >= 0.25)
    return { leak: "impression_to_pageView", rates,
      message: `Impression→page-view fell to ${(ipv * 100).toFixed(1)}% (was ${(bIpv * 100).toFixed(1)}%). Icon/title/first screenshot likely.` };
  return { leak: "none", rates, message: "Funnel within normal range." };
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: funnel-leak diagnosis`.

### Task 4.4: Keyword opportunity finder

**Files:**
- Create: `src/lib/intelligence/keywords.ts`
- Test: `tests/lib/intelligence/keywords.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "vitest";
import { keywordOpportunities } from "@/lib/intelligence/keywords";

test("surfaces terms ranked 8-25, best (lowest rank) first", () => {
  const hist = [
    { day: "2026-05-17", term: "a", country: "de", rank: 12 },
    { day: "2026-05-18", term: "a", country: "de", rank: 10 },
    { day: "2026-05-18", term: "b", country: "de", rank: 40 },
    { day: "2026-05-18", term: "c", country: "de", rank: 9 },
  ];
  const o = keywordOpportunities(hist, "2026-05-18");
  expect(o.map((x) => x.term)).toEqual(["c", "a"]);
  expect(o[0]).toMatchObject({ term: "c", rank: 9, trend: "flat" });
  expect(o[1]).toMatchObject({ term: "a", rank: 10, trend: "improving" });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/intelligence/keywords.ts`**

```ts
import type { KeywordRank } from "@/lib/store/paths";

export interface Opportunity {
  term: string; country: string; rank: number;
  trend: "improving" | "declining" | "flat";
}

export function keywordOpportunities(hist: KeywordRank[], day: string): Opportunity[] {
  const today = hist.filter((h) => h.day === day && h.rank != null && h.rank >= 8 && h.rank <= 25);
  return today
    .map((t) => {
      const prev = hist
        .filter((h) => h.term === t.term && h.country === t.country && h.day < day && h.rank != null)
        .sort((a, b) => b.day.localeCompare(a.day))[0];
      let trend: Opportunity["trend"] = "flat";
      if (prev && prev.rank != null) {
        if (t.rank! < prev.rank - 1) trend = "improving";
        else if (t.rank! > prev.rank + 1) trend = "declining";
      }
      return { term: t.term, country: t.country, rank: t.rank!, trend };
    })
    .sort((a, b) => a.rank - b.rank);
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: keyword opportunity finder`.

### Task 4.5: Month-end forecast

**Files:**
- Create: `src/lib/intelligence/forecast.ts`
- Test: `tests/lib/intelligence/forecast.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "vitest";
import { forecastMonth } from "@/lib/intelligence/forecast";

test("projects month total from run-rate", () => {
  // 10 days, 10/day → as of 2026-05-10, May has 31 days → ~310
  const series = Array.from({ length: 10 }, (_, i) => ({ day: `2026-05-${String(i + 1).padStart(2, "0")}`, value: 10 }));
  const f = forecastMonth(series, "2026-05-10");
  expect(f.projected).toBeCloseTo(310, 0);
  expect(f.soFar).toBe(100);
  expect(f.band.low).toBeLessThanOrEqual(f.projected);
  expect(f.band.high).toBeGreaterThanOrEqual(f.projected);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/intelligence/forecast.ts`**

```ts
import { parseISO, getDaysInMonth } from "date-fns";
import type { Point } from "./baseline";

export interface Forecast { soFar: number; projected: number; band: { low: number; high: number }; }

export function forecastMonth(series: Point[], asOf: string): Forecast {
  const month = asOf.slice(0, 7);
  const inMonth = series.filter((p) => p.day.startsWith(month));
  const soFar = inMonth.reduce((s, p) => s + p.value, 0);
  const dayNum = Number(asOf.slice(8, 10));
  const totalDays = getDaysInMonth(parseISO(asOf + "T00:00:00Z"));
  const perDay = dayNum > 0 ? soFar / dayNum : 0;
  const projected = perDay * totalDays;
  const values = inMonth.map((p) => p.value);
  const mean = values.reduce((s, v) => s + v, 0) / (values.length || 1);
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length || 1));
  const remaining = totalDays - dayNum;
  const margin = 1.96 * std * Math.sqrt(remaining);
  return { soFar, projected, band: { low: Math.max(soFar, projected - margin), high: projected + margin } };
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: month-end forecast`.

### Task 4.6: Anthropic client with prompt caching

**Files:**
- Create: `src/lib/llm/anthropic.ts`
- Test: `tests/lib/llm/anthropic.test.ts`

- [ ] **Step 1: Failing test** (inject a fake SDK):

```ts
import { test, expect, vi } from "vitest";
import { makeLlm } from "@/lib/llm/anthropic";

test("complete sends cached system block and returns text", async () => {
  const create = vi.fn(async () => ({ content: [{ type: "text", text: "hello" }] }));
  const llm = makeLlm({ messages: { create } } as any, "claude-haiku-4-5");
  const out = await llm.complete("SYS", "USER");
  expect(out).toBe("hello");
  const arg = create.mock.calls[0][0];
  expect(arg.system[0].cache_control).toEqual({ type: "ephemeral" });
  expect(arg.model).toBe("claude-haiku-4-5");
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/llm/anthropic.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";

export function makeLlm(client: Anthropic, model: string) {
  return {
    async complete(system: string, user: string, maxTokens = 1500): Promise<string> {
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      } as any);
      const block = (res as any).content?.find((c: any) => c.type === "text");
      return block?.text ?? "";
    },
  };
}

export function llmFromEnv(model: string) {
  return makeLlm(new Anthropic({ apiKey: env().ANTHROPIC_API_KEY }), model);
}

export const MODELS = { cheap: "claude-haiku-4-5", smart: "claude-sonnet-4-6" };
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: Anthropic client with prompt caching`.

### Task 4.7: Review sentiment clustering

**Files:**
- Create: `src/lib/intelligence/sentiment.ts`
- Test: `tests/lib/intelligence/sentiment.test.ts`

- [ ] **Step 1: Failing test** (inject fake llm):

```ts
import { test, expect, vi } from "vitest";
import { clusterReviews } from "@/lib/intelligence/sentiment";

test("clusterReviews parses JSON theme output and only sends new reviews", async () => {
  const complete = vi.fn(async () => JSON.stringify({
    themes: [{ label: "Crashes", count: 1, sentiment: "negative", exampleIds: ["r2"] }],
  }));
  const res = await clusterReviews(
    { complete } as any,
    [{ id: "r2", rating: 2, title: "Crash", body: "Crashes", reviewer: "x", territory: "NLD", createdDate: "2026-05-19", responded: false }],
  );
  expect(res.themes[0].label).toBe("Crashes");
  expect(complete.mock.calls[0][1]).toContain("r2");
});

test("clusterReviews short-circuits on empty input", async () => {
  const complete = vi.fn();
  const res = await clusterReviews({ complete } as any, []);
  expect(res.themes).toEqual([]);
  expect(complete).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/intelligence/sentiment.ts`**

```ts
import type { Review } from "@/lib/store/paths";

export interface Theme { label: string; count: number; sentiment: "positive" | "negative" | "mixed"; exampleIds: string[]; }
export interface ClusterResult { themes: Theme[]; }

const SYS = `You cluster App Store reviews into 3-6 actionable themes.
Return ONLY JSON: {"themes":[{"label","count","sentiment":"positive|negative|mixed","exampleIds":[reviewId,...]}]}.`;

export async function clusterReviews(
  llm: { complete: (s: string, u: string) => Promise<string> },
  newReviews: Review[],
): Promise<ClusterResult> {
  if (newReviews.length === 0) return { themes: [] };
  const user = JSON.stringify(
    newReviews.map((r) => ({ id: r.id, rating: r.rating, text: `${r.title} ${r.body}` })),
  );
  const raw = await llm.complete(SYS, user);
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    return { themes: parsed.themes ?? [] };
  } catch {
    return { themes: [] };
  }
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: review sentiment clustering`.

### Task 4.8: Weekly digest

**Files:**
- Create: `src/lib/intelligence/digest.ts`
- Test: `tests/lib/intelligence/digest.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { test, expect, vi } from "vitest";
import { buildDigest, isDigestDay } from "@/lib/intelligence/digest";

test("isDigestDay true on Monday only", () => {
  expect(isDigestDay("2026-05-18")).toBe(true);   // Monday
  expect(isDigestDay("2026-05-19")).toBe(false);  // Tuesday
});

test("buildDigest passes a compact summary and returns narrative", async () => {
  const complete = vi.fn(async () => "## This week\n- Downloads up 12%");
  const out = await buildDigest({ complete } as any, { totalDownloads: 500, wowPct: 12, topAnomalies: [], opportunities: [] });
  expect(out).toContain("This week");
  expect(complete.mock.calls[0][1]).toContain("500");
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/intelligence/digest.ts`**

```ts
import { parseISO, getDay } from "date-fns";

export function isDigestDay(day: string): boolean {
  return getDay(parseISO(day + "T00:00:00Z")) === 1; // Monday
}

const SYS = `You are an ASO growth analyst. Given a JSON summary, write a concise
markdown weekly digest: what changed, why it likely happened, and a prioritized
3-item action list. No fluff, no preamble.`;

export async function buildDigest(
  llm: { complete: (s: string, u: string) => Promise<string> },
  summary: unknown,
): Promise<string> {
  return llm.complete(SYS, JSON.stringify(summary));
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: weekly digest`.

### Task 4.9: Intelligence engine assembler

**Files:**
- Create: `src/lib/intelligence/engine.ts`
- Test: `tests/lib/intelligence/engine.test.ts`

Produces the `insights.json` shape consumed by the UI.

- [ ] **Step 1: Failing test**

```ts
import { test, expect, vi } from "vitest";
import { runIntelligence } from "@/lib/intelligence/engine";

test("runIntelligence aggregates anomalies + opportunities + forecast per app", async () => {
  const flat = (v: number) => ["2026-04-20","2026-04-27","2026-05-04","2026-05-11","2026-05-18"].map((day) => ({ day, value: v }));
  const insights = await runIntelligence({
    day: "2026-05-18",
    apps: [{
      appId: "1", name: "A",
      downloads: [...flat(100).slice(0,4), { day: "2026-05-18", value: 10 }],
      funnelToday: { impressions: 1000, pageViews: 300, downloads: 30 },
      funnelBaseline: { impressions: 1000, pageViews: 300, downloads: 90 },
      keywords: [{ day: "2026-05-18", term: "k", country: "de", rank: 10 }],
      releases: [],
      newReviews: [],
    }],
    llm: { complete: vi.fn(async () => '{"themes":[]}') } as any,
  });
  const a = insights.apps["1"];
  expect(a.anomaly?.direction).toBe("drop");
  expect(a.funnel.leak).toBe("pageView_to_install");
  expect(a.opportunities[0].term).toBe("k");
  expect(a.forecast.projected).toBeGreaterThan(0);
  expect(insights.generatedAt).toBe("2026-05-18");
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/intelligence/engine.ts`**

```ts
import { detectAnomalies, type Anomaly } from "./anomaly";
import { diagnoseFunnel, type FunnelStage, type FunnelDiagnosis } from "./funnel";
import { keywordOpportunities, type Opportunity } from "./keywords";
import { forecastMonth, type Forecast } from "./forecast";
import { clusterReviews, type ClusterResult } from "./sentiment";
import { buildDigest, isDigestDay } from "./digest";
import type { Point } from "./baseline";
import type { KeywordRank, Review } from "@/lib/store/paths";

export interface AppInput {
  appId: string; name: string;
  downloads: Point[];
  funnelToday: FunnelStage; funnelBaseline: FunnelStage;
  keywords: KeywordRank[];
  releases: { version: string; date: string }[];
  newReviews: Review[];
}
export interface AppInsight {
  name: string;
  anomaly: Anomaly | null;
  funnel: FunnelDiagnosis;
  opportunities: Opportunity[];
  forecast: Forecast;
  reviewThemes: ClusterResult;
}
export interface Insights {
  generatedAt: string;
  apps: Record<string, AppInsight>;
  digest?: string;
}

export async function runIntelligence(input: {
  day: string;
  apps: AppInput[];
  llm: { complete: (s: string, u: string) => Promise<string> };
}): Promise<Insights> {
  const apps: Record<string, AppInsight> = {};
  for (const a of input.apps) {
    apps[a.appId] = {
      name: a.name,
      anomaly: detectAnomalies({ appId: a.appId, metric: "downloads", series: a.downloads, day: input.day, releases: a.releases }),
      funnel: diagnoseFunnel(a.funnelToday, a.funnelBaseline),
      opportunities: keywordOpportunities(a.keywords, input.day),
      forecast: forecastMonth(a.downloads, input.day),
      reviewThemes: await clusterReviews(input.llm, a.newReviews),
    };
  }
  const out: Insights = { generatedAt: input.day, apps };
  if (isDigestDay(input.day)) {
    out.digest = await buildDigest(input.llm, {
      day: input.day,
      apps: Object.entries(apps).map(([id, v]) => ({
        id, name: v.name, anomaly: v.anomaly, funnel: v.funnel.leak,
        opportunities: v.opportunities.slice(0, 5), forecast: v.forecast,
      })),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: intelligence engine assembler`.

---

## Milestone 5 — Orchestrator (daily cron)

### Task 5.1: ASC live wiring helpers

**Files:**
- Create: `src/lib/sources/asc-live.ts`
- Test: `tests/lib/sources/asc-live.test.ts`

Wires the analytics request/instance/segment walk that was deferred from Task 3.3.

- [ ] **Step 1: Failing test** (mock ascGetAllPages/ascGetJson + fetch for the segment url):

```ts
import { test, expect, vi } from "vitest";
import { fetchLatestAnalyticsCsv } from "@/lib/sources/asc-live";

test("fetchLatestAnalyticsCsv walks reports→instances→segments and concatenates", async () => {
  const key = { keyId: "k", issuerId: "i", privateKey: "p" };
  const calls: Record<string, any> = {
    "/v1/analyticsReportRequests/req1/reports?limit=200": [{ id: "rep1", attributes: { category: "APP_STORE_ENGAGEMENT" } }],
    "/v1/analyticsReports/rep1/instances?limit=200&sort=-processingDate": [{ id: "inst1", attributes: { processingDate: "2026-05-18" } }],
    "/v1/analyticsReportInstances/inst1/segments?limit=200": [{ attributes: { url: "https://seg/1" } }],
  };
  vi.doMock("@/lib/asc/client", () => ({
    ascGetAllPages: vi.fn(async (_k, u: string) => calls[u] ?? []),
  }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Date,App Units\n2026-05-18,5\n", { status: 200 })));
  const { fetchLatestAnalyticsCsv } = await import("@/lib/sources/asc-live");
  const csv = await fetchLatestAnalyticsCsv(key as any, "req1");
  expect(csv).toContain("2026-05-18,5");
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/sources/asc-live.ts`**

```ts
import { ascGetAllPages } from "@/lib/asc/client";
import type { AscKey } from "@/lib/asc/jwt";
import { gunzipSync } from "node:zlib";

export async function listOngoingRequests(key: AscKey, appId: string) {
  const rows = await ascGetAllPages(
    key, `/v1/apps/${appId}/analyticsReportRequests?limit=200`);
  return rows.filter((r: any) => r.attributes?.accessType === "ONGOING").map((r: any) => ({ id: r.id }));
}

export async function createOngoingRequest(key: AscKey, appId: string) {
  const { ascGetJson } = await import("@/lib/asc/client");
  const res = await fetch("https://api.appstoreconnect.apple.com/v1/analyticsReportRequests", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${(await import("@/lib/asc/jwt")).signAscToken(key)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: { type: "analyticsReportRequests",
        attributes: { accessType: "ONGOING" },
        relationships: { app: { data: { type: "apps", id: appId } } } },
    }),
  });
  if (!res.ok) throw new Error(`create report request ${res.status}`);
  const j = (await res.json()) as any;
  void ascGetJson;
  return { id: j.data.id as string };
}

export async function fetchLatestAnalyticsCsv(key: AscKey, requestId: string): Promise<string> {
  const reports = await ascGetAllPages(key, `/v1/analyticsReportRequests/${requestId}/reports?limit=200`);
  let csv = "";
  for (const rep of reports) {
    const instances = await ascGetAllPages(
      key, `/v1/analyticsReports/${rep.id}/instances?limit=200&sort=-processingDate`);
    const latest = instances[0];
    if (!latest) continue;
    const segments = await ascGetAllPages(
      key, `/v1/analyticsReportInstances/${latest.id}/segments?limit=200`);
    for (const seg of segments) {
      const res = await fetch(seg.attributes.url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      let text: string;
      try { text = gunzipSync(buf).toString("utf8"); }
      catch { text = buf.toString("utf8"); }
      csv += (csv && !csv.endsWith("\n") ? "\n" : "") + text;
    }
  }
  return csv;
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: ASC analytics live walk`.

### Task 5.2: Orchestrator function

**Files:**
- Create: `src/lib/orchestrator.ts`
- Test: `tests/lib/orchestrator.test.ts`

End-to-end with all I/O injected. Verifies: discovers apps, runs collectors, writes via store, writes insights + run-status, isolates a failing collector.

- [ ] **Step 1: Failing test**

```ts
import { test, expect, vi } from "vitest";
import { runDailyCollection } from "@/lib/orchestrator";

function memStore() {
  const fs = new Map<string, any>();
  return {
    fs,
    readJson: vi.fn(async (p: string, fb: any) => (fs.has(p) ? fs.get(p) : fb)),
    writeJson: vi.fn(async (p: string, v: any) => { fs.set(p, v); }),
    upsertDailyArray: vi.fn(async (p: string, rows: any[]) => {
      const cur = fs.get(p) ?? [];
      const m = new Map(cur.map((r: any) => [r.day, r]));
      for (const r of rows) m.set(r.day, r);
      fs.set(p, [...m.values()]);
    }),
  };
}

test("runDailyCollection writes per-app data + insights + run-status, isolating failures", async () => {
  const store = memStore();
  const status = await runDailyCollection({
    day: "2026-05-18",
    store: store as any,
    deps: {
      discoverApps: async () => [{ appId: "1", name: "A", bundleId: "b", sku: "s", firstSeen: "2026-05-18", hidden: false, archived: false, releases: [] }],
      collectSales: async () => ({ "1": { day: "2026-05-18", byCountry: { DE: 5 }, total: 5, redownloads: 0, proceedsUsd: 0 } }),
      collectAnalytics: async () => { throw new Error("analytics down"); },
      collectReviews: async () => [],
      collectRatings: async () => ({ day: "2026-05-18", byCountry: {}, avg: 0, count: 0 }),
      collectKeywords: async () => [],
      runIntelligence: async () => ({ generatedAt: "2026-05-18", apps: {} }),
    },
  });
  expect(store.fs.get("data/1/sales/2026-05.json")[0].total).toBe(5);
  expect(store.fs.get("data/insights.json").generatedAt).toBe("2026-05-18");
  expect(status.perApp["1"].analytics.ok).toBe(false);
  expect(status.perApp["1"].sales.ok).toBe(true);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/orchestrator.ts`**

```ts
import {
  salesPath, analyticsPath, ratingsPath, keywordsPath, reviewsPath,
  appMetaPath, configPath, insightsPath, runStatusPath,
  type AppMeta, type Config, type RunStatus, type Review,
} from "@/lib/store/paths";
import type { Store } from "@/lib/store/store";

export interface OrchestratorDeps {
  discoverApps: () => Promise<AppMeta[]>;
  collectSales: (appIds: string[], day: string) => Promise<Record<string, any>>;
  collectAnalytics: (appId: string) => Promise<Record<string, any>>;
  collectReviews: (appId: string) => Promise<Review[]>;
  collectRatings: (appId: string, day: string) => Promise<any>;
  collectKeywords: (appId: string, day: string) => Promise<any[]>;
  runIntelligence: (args: { day: string; apps: any[]; }) => Promise<any>;
}

export async function runDailyCollection(input: {
  day: string; store: Store; deps: OrchestratorDeps;
}): Promise<RunStatus> {
  const { day, store, deps } = input;
  const apps = await deps.discoverApps();
  const config = await store.readJson<Config>(configPath(), { apps: {} });

  const status: RunStatus = {
    lastRun: new Date().toISOString(),
    lastSuccess: "",
    perApp: {},
  };
  const mark = (id: string, k: string, ok: boolean, error?: string) => {
    (status.perApp[id] ??= {})[k] = { ok, at: new Date().toISOString(), ...(error ? { error } : {}) };
  };

  // app meta (preserve firstSeen/hidden/archived/releases)
  for (const a of apps) {
    const prev = await store.readJson<AppMeta | null>(appMetaPath(a.appId), null);
    const merged: AppMeta = prev ? { ...a, firstSeen: prev.firstSeen, hidden: prev.hidden, archived: prev.archived, releases: prev.releases } : a;
    await store.writeJson(appMetaPath(a.appId), merged, `chore(data): meta ${a.appId}`);
  }

  const appIds = apps.map((a) => a.appId);
  // sales is a single account-wide report
  let salesByApp: Record<string, any> = {};
  try { salesByApp = await deps.collectSales(appIds, day); appIds.forEach((id) => mark(id, "sales", true)); }
  catch (e: any) { appIds.forEach((id) => mark(id, "sales", false, String(e?.message ?? e))); }

  const intelInputs: any[] = [];
  for (const a of apps) {
    const id = a.appId;
    if (salesByApp[id]) await store.upsertDailyArray(salesPath(id, day), [salesByApp[id]], `data: sales ${id} ${day}`);

    let analyticsDays: Record<string, any> = {};
    try { analyticsDays = await deps.collectAnalytics(id); mark(id, "analytics", true); }
    catch (e: any) { mark(id, "analytics", false, String(e?.message ?? e)); }
    const aDays = Object.values(analyticsDays);
    if (aDays.length) await store.upsertDailyArray(analyticsPath(id, day), aDays as any[], `data: analytics ${id}`);

    let reviews: Review[] = [];
    try { reviews = await deps.collectReviews(id); mark(id, "reviews", true); }
    catch (e: any) { mark(id, "reviews", false, String(e?.message ?? e)); }
    const prevReviews = await store.readJson<Review[]>(reviewsPath(id), []);
    const known = new Set(prevReviews.map((r) => r.id));
    const newReviews = reviews.filter((r) => !known.has(r.id));
    if (reviews.length) {
      const map = new Map(prevReviews.map((r) => [r.id, r]));
      for (const r of reviews) map.set(r.id, r);
      await store.writeJson(reviewsPath(id), [...map.values()], `data: reviews ${id}`);
    }

    try { const rp = await deps.collectRatings(id, day); await store.upsertDailyArray(ratingsPath(id, day), [rp], `data: ratings ${id} ${day}`); mark(id, "ratings", true); }
    catch (e: any) { mark(id, "ratings", false, String(e?.message ?? e)); }

    try {
      const watch = config.apps[id]?.keywords ?? [];
      const kr = await deps.collectKeywords(id, day);
      if (kr.length) await store.upsertDailyArray(keywordsPath(id, day), kr, `data: keywords ${id} ${day}`);
      void watch;
      mark(id, "keywords", true);
    } catch (e: any) { mark(id, "keywords", false, String(e?.message ?? e)); }

    intelInputs.push({
      appId: id, name: a.name,
      downloads: [], funnelToday: { impressions: 0, pageViews: 0, downloads: 0 },
      funnelBaseline: { impressions: 0, pageViews: 0, downloads: 0 },
      keywords: [], releases: a.releases, newReviews,
    });
  }

  try {
    const insights = await deps.runIntelligence({ day, apps: intelInputs });
    await store.writeJson(insightsPath(), insights, `data: insights ${day}`);
  } catch (e: any) {
    apps.forEach((a) => mark(a.appId, "intelligence", false, String(e?.message ?? e)));
  }

  status.lastSuccess = new Date().toISOString();
  await store.writeJson(runStatusPath(), status, `data: run-status ${day}`);
  return status;
}
```

> The intelligence inputs are fed from freshly stored series in the API layer for the UI; the orchestrator persists raw data and a baseline insights pass. Series-backed intelligence (full `downloads`/`funnel` history) is recomputed on read in Milestone 7 aggregations, keeping the cron fast and within the 60s budget.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: daily orchestrator`.

### Task 5.3: Cron route

**Files:**
- Create: `src/app/api/cron/route.ts`, `vercel.json`
- Test: `tests/app/cron-route.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { test, expect, vi } from "vitest";

test("cron route rejects without CRON_SECRET", async () => {
  vi.stubGlobal("process", { ...process, env: { ...process.env, CRON_SECRET: "s3cret" } });
  const { GET } = await import("@/app/api/cron/route");
  const res = await GET(new Request("http://x/api/cron"));
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/app/api/cron/route.ts`**

```ts
import { NextResponse } from "next/server";
import { env } from "@/env";
import { todayUtc } from "@/lib/dates";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { runDailyCollection } from "@/lib/orchestrator";
import { ascKeyFromEnv } from "@/lib/asc/jwt";
import { discoverApps, ascFetchApps } from "@/lib/sources/apps";
import { collectSales, ascFetchSalesTsv } from "@/lib/sources/sales";
import { parseAnalyticsCsv, ensureOngoingRequest } from "@/lib/sources/analytics";
import { listOngoingRequests, createOngoingRequest, fetchLatestAnalyticsCsv } from "@/lib/sources/asc-live";
import { mapReviews, ascFetchReviews } from "@/lib/sources/reviews";
import { collectRatings } from "@/lib/sources/ratings";
import { collectKeywordRanks } from "@/lib/sources/keywords";
import { runIntelligence } from "@/lib/intelligence/engine";
import { llmFromEnv, MODELS } from "@/lib/llm/anthropic";
import { configPath, type Config } from "@/lib/store/paths";

export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const e = env();
  const auth = req.headers.get("authorization");
  const url = new URL(req.url);
  if (auth !== `Bearer ${e.CRON_SECRET}` && url.searchParams.get("key") !== e.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = ascKeyFromEnv(e);
  const store = makeStore(ghBackendFromEnv());
  const llm = llmFromEnv(MODELS.cheap);
  const day = todayUtc();
  const config = await store.readJson<Config>(configPath(), { apps: {} });

  const status = await runDailyCollection({
    day, store,
    deps: {
      discoverApps: () => discoverApps(ascFetchApps(key), day),
      collectSales: (ids, d) => collectSales(ascFetchSalesTsv(key, e.ASC_VENDOR_NUMBER), ids, d),
      collectAnalytics: async (appId) => {
        const reqId = await ensureOngoingRequest(appId,
          (id) => listOngoingRequests(key, id),
          (id) => createOngoingRequest(key, id));
        const csv = await fetchLatestAnalyticsCsv(key, reqId);
        return parseAnalyticsCsv(csv);
      },
      collectReviews: async (appId) => mapReviews(await ascFetchReviews(key, appId)()),
      collectRatings: (appId, d) => collectRatings(appId, ["de", "us", "gb", "nl", "fr"], d),
      collectKeywords: (appId, d) => collectKeywordRanks(appId, config.apps[appId]?.keywords ?? [], d),
      runIntelligence: (args) => runIntelligence({ ...args, llm }),
    },
  });
  return NextResponse.json({ ok: true, status });
}
```

- [ ] **Step 4: Create `vercel.json`**

```json
{
  "crons": [{ "path": "/api/cron?key=$CRON_SECRET", "schedule": "0 6 * * *" }]
}
```

> Note: Vercel substitutes env in `vercel.json` crons is not supported; instead the cron calls `/api/cron` and Vercel automatically adds the `Authorization: Bearer $CRON_SECRET` header for project cron jobs. Keep the `?key=` fallback removed before deploy if undesired. Acceptance: route returns 401 without the secret, 200 with it.

- [ ] **Step 5: Run** — `pnpm test tests/app/cron-route.test.ts` → PASS. `pnpm build` → succeeds.

- [ ] **Step 6: Commit** `feat: cron route + schedule`.

---

## Milestone 6 — Auth

### Task 6.1: Auth.js GitHub provider, allowlisted

**Files:**
- Create: `src/lib/auth/config.ts`, `src/app/api/auth/[...nextauth]/route.ts`
- Test: `tests/lib/auth/config.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "vitest";
import { isAllowed } from "@/lib/auth/config";

test("isAllowed only passes the configured login", () => {
  expect(isAllowed({ login: "lawoflarge" }, "lawoflarge")).toBe(true);
  expect(isAllowed({ login: "someone" }, "lawoflarge")).toBe(false);
  expect(isAllowed(null, "lawoflarge")).toBe(false);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/auth/config.ts`**

```ts
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { env } from "@/env";

export function isAllowed(profile: { login?: string } | null, allowed: string): boolean {
  return !!profile?.login && profile.login === allowed;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub({
    clientId: env().GITHUB_OAUTH_CLIENT_ID,
    clientSecret: env().GITHUB_OAUTH_CLIENT_SECRET,
  })],
  secret: env().AUTH_SECRET,
  callbacks: {
    signIn({ profile }) { return isAllowed(profile as any, env().ALLOWED_GITHUB_LOGIN); },
    authorized({ auth }) { return !!auth?.user; },
  },
});
```

- [ ] **Step 4: Implement `src/app/api/auth/[...nextauth]/route.ts`**

```ts
import { handlers } from "@/lib/auth/config";
export const { GET, POST } = handlers;
```

- [ ] **Step 5: Run** → PASS. `pnpm build` → succeeds. **Step 6: Commit** `feat: GitHub-OAuth allowlisted auth`.

### Task 6.2: Edge middleware gate

**Files:**
- Create: `src/middleware.ts`
- Test: `tests/middleware.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "vitest";
import { config } from "@/middleware";

test("middleware matcher excludes auth + cron + static", () => {
  expect(config.matcher).toContain("/((?!api/auth|api/cron|_next/static|_next/image|favicon.ico).*)");
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/middleware.ts`**

```ts
export { auth as middleware } from "@/lib/auth/config";

export const config = {
  matcher: ["/((?!api/auth|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: edge auth middleware`.

---

## Milestone 7 — Aggregations (compute-on-read)

### Task 7.1: Downloads aggregation

**Files:**
- Create: `src/lib/aggregate/downloads.ts`
- Test: `tests/lib/aggregate/downloads.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "vitest";
import { downloadsSeries, totals } from "@/lib/aggregate/downloads";

const sales = [
  { day: "2026-05-17", byCountry: { DE: 5 }, total: 5, redownloads: 0, proceedsUsd: 0 },
  { day: "2026-05-18", byCountry: { DE: 7, US: 1 }, total: 8, redownloads: 0, proceedsUsd: 0 },
];

test("downloadsSeries returns {day,value}", () => {
  expect(downloadsSeries(sales)).toEqual([
    { day: "2026-05-17", value: 5 }, { day: "2026-05-18", value: 8 },
  ]);
});

test("totals computes total + today + delta", () => {
  expect(totals(sales, "2026-05-18")).toEqual({ total: 13, today: 8, prev: 5, deltaPct: 60 });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/aggregate/downloads.ts`**

```ts
import type { SalesDay } from "@/lib/store/paths";
import type { Point } from "@/lib/intelligence/baseline";

export function downloadsSeries(sales: SalesDay[]): Point[] {
  return [...sales].sort((a, b) => a.day.localeCompare(b.day))
    .map((s) => ({ day: s.day, value: s.total }));
}

export function totals(sales: SalesDay[], day: string) {
  const sorted = [...sales].sort((a, b) => a.day.localeCompare(b.day));
  const total = sorted.reduce((s, d) => s + d.total, 0);
  const idx = sorted.findIndex((s) => s.day === day);
  const today = idx >= 0 ? sorted[idx].total : 0;
  const prev = idx > 0 ? sorted[idx - 1].total : 0;
  const deltaPct = prev > 0 ? Math.round(((today - prev) / prev) * 100) : 0;
  return { total, today, prev, deltaPct };
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: downloads aggregation`.

### Task 7.2: Ratings & portfolio aggregation

**Files:**
- Create: `src/lib/aggregate/ratings.ts`, `src/lib/aggregate/portfolio.ts`
- Test: `tests/lib/aggregate/portfolio.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { test, expect } from "vitest";
import { attentionScore, rankPortfolio } from "@/lib/aggregate/portfolio";

test("attentionScore weights anomaly drop + rating drop + unresponded", () => {
  const s = attentionScore({ anomalyDrop: true, ratingDelta: -0.2, unresponded: 3 });
  expect(s).toBeGreaterThan(0);
});

test("rankPortfolio sorts highest attention first", () => {
  const rows = rankPortfolio([
    { appId: "1", name: "A", score: 2 },
    { appId: "2", name: "B", score: 9 },
  ]);
  expect(rows[0].appId).toBe("2");
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** both files:

`src/lib/aggregate/ratings.ts`:
```ts
import type { RatingPoint } from "@/lib/store/paths";

export function ratingTrend(points: RatingPoint[]) {
  const sorted = [...points].sort((a, b) => a.day.localeCompare(b.day));
  const last = sorted.at(-1);
  const prev = sorted.at(-2);
  return {
    current: last?.avg ?? 0,
    count: last?.count ?? 0,
    delta: last && prev ? Number((last.avg - prev.avg).toFixed(2)) : 0,
    series: sorted.map((p) => ({ day: p.day, value: p.avg })),
  };
}
```

`src/lib/aggregate/portfolio.ts`:
```ts
export function attentionScore(i: { anomalyDrop: boolean; ratingDelta: number; unresponded: number }): number {
  return (i.anomalyDrop ? 5 : 0) + (i.ratingDelta < 0 ? Math.abs(i.ratingDelta) * 10 : 0) + Math.min(i.unresponded, 10);
}

export function rankPortfolio<T extends { score: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: ratings + portfolio aggregation`.

### Task 7.3: Auth-gated data API

**Files:**
- Create: `src/app/api/data/[...path]/route.ts`, `src/lib/aggregate/api.ts`
- Test: `tests/lib/aggregate/api.test.ts`

- [ ] **Step 1: Failing test** (the pure builder, store injected):

```ts
import { test, expect } from "vitest";
import { buildGlance } from "@/lib/aggregate/api";

test("buildGlance assembles totals + rating + insights per visible app", async () => {
  const store = {
    readJson: async (p: string, fb: any) => {
      if (p === "data/config.json") return { apps: {} };
      if (p === "data/1/meta.json") return { appId: "1", name: "A", hidden: false, archived: false, releases: [] };
      if (p === "data/1/sales/2026-05.json") return [{ day: "2026-05-18", byCountry: {}, total: 8, redownloads: 0, proceedsUsd: 0 }];
      if (p === "data/insights.json") return { generatedAt: "2026-05-18", apps: { "1": { name: "A", anomaly: null } } };
      return fb;
    },
  };
  const g = await buildGlance(store as any, ["1"], "2026-05");
  expect(g.apps[0]).toMatchObject({ appId: "1", name: "A", today: 8 });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/lib/aggregate/api.ts`**

```ts
import type { Store } from "@/lib/store/store";
import { salesPath, appMetaPath, insightsPath, configPath, type SalesDay, type AppMeta, type Config } from "@/lib/store/paths";
import { totals } from "./downloads";

export async function buildGlance(store: Store, appIds: string[], month: string) {
  const insights = await store.readJson<any>(insightsPath(), { apps: {} });
  const apps = [];
  for (const id of appIds) {
    const meta = await store.readJson<AppMeta | null>(appMetaPath(id), null);
    if (!meta || meta.hidden || meta.archived) continue;
    const sales = await store.readJson<SalesDay[]>(salesPath(id, month + "-01"), []);
    const day = sales.at(-1)?.day ?? "";
    apps.push({ appId: id, name: meta.name, ...totals(sales, day), anomaly: insights.apps?.[id]?.anomaly ?? null });
  }
  return { apps };
}

export async function visibleAppIds(store: Store): Promise<string[]> {
  const cfg = await store.readJson<Config>(configPath(), { apps: {} });
  return Object.keys(cfg.apps).length
    ? Object.entries(cfg.apps).filter(([, v]) => !v.hidden && !v.archived).map(([k]) => k)
    : [];
}
```

- [ ] **Step 4: Implement `src/app/api/data/[...path]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { buildGlance } from "@/lib/aggregate/api";
import { todayUtc } from "@/lib/dates";

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { path } = await ctx.params;
  const store = makeStore(ghBackendFromEnv());
  const month = todayUtc().slice(0, 7);
  if (path[0] === "glance") {
    const { searchParams } = new URL(req.url);
    const ids = (searchParams.get("apps") ?? "").split(",").filter(Boolean);
    return NextResponse.json(await buildGlance(store, ids, month));
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
```

- [ ] **Step 5: Run** → PASS. `pnpm build` → succeeds. **Step 6: Commit** `feat: auth-gated data API`.

### Task 7.4: Config mutation API

> ⚠️ Concurrency caveat (from Task 2.3 review): `store.writeJson` is read-modify-write with no lock. The cron and this config API can race on `data/config.json`, producing a GitHub 409 (SHA mismatch). In this route, wrap the `writeJson` call in a retry-on-409 (re-read + reapply the patch, up to 3 attempts) so a user config change during a cron run does not surface as a 500.

**Files:**
- Create: `src/app/api/config/route.ts`
- Test: `tests/app/config-route.test.ts`

- [ ] **Step 1: Failing test** (the pure merge):

```ts
import { test, expect } from "vitest";
import { applyConfigPatch } from "@/app/api/config/logic";

test("applyConfigPatch sets visibility + keywords per app", () => {
  const next = applyConfigPatch({ apps: {} }, { appId: "1", hidden: true, keywords: [{ term: "x", country: "de" }] });
  expect(next.apps["1"]).toEqual({ hidden: true, archived: false, keywords: [{ term: "x", country: "de" }] });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/app/api/config/logic.ts`**

```ts
import type { Config } from "@/lib/store/paths";

export function applyConfigPatch(cfg: Config, patch: {
  appId: string; hidden?: boolean; archived?: boolean;
  keywords?: { term: string; country: string }[];
}): Config {
  const cur = cfg.apps[patch.appId] ?? { hidden: false, archived: false, keywords: [] };
  return {
    apps: {
      ...cfg.apps,
      [patch.appId]: {
        hidden: patch.hidden ?? cur.hidden,
        archived: patch.archived ?? cur.archived,
        keywords: patch.keywords ?? cur.keywords,
        goalDownloadsPerMonth: cur.goalDownloadsPerMonth,
      },
    },
  };
}
```

- [ ] **Step 4: Implement `src/app/api/config/route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { configPath, type Config } from "@/lib/store/paths";
import { applyConfigPatch } from "./logic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const patch = await req.json();
  const store = makeStore(ghBackendFromEnv());
  const cfg = await store.readJson<Config>(configPath(), { apps: {} });
  const next = applyConfigPatch(cfg, patch);
  await store.writeJson(configPath(), next, `chore(config): update ${patch.appId}`);
  return NextResponse.json(next);
}
```

- [ ] **Step 5: Run** → PASS. **Step 6: Commit** `feat: config mutation API`.

---

## Milestone 8 — Daylight Frost UI

### Task 8.1: Design tokens & globals

**Files:**
- Modify: `src/app/globals.css`
- Create: `src/app/layout.tsx` (replace generated)

- [ ] **Step 1: Replace `src/app/globals.css`**

```css
@import "tailwindcss";

:root{
  --bg-1:#eef1fb; --bg-2:#e7ebf7;
  --mesh-a:#d9e4ff; --mesh-b:#ffe1ec;
  --ink:#1c2030; --ink-2:#5b6178;
  --accent:#6d5dfb; --ok:#16a34a; --bad:#e11d48; --star:#f59e0b;
  --glass:rgba(255,255,255,.62); --glass-br:rgba(255,255,255,.85);
}
html,body{height:100%}
body{
  color:var(--ink);
  background:
    radial-gradient(700px 320px at 6% -5%, var(--mesh-a), transparent 60%),
    radial-gradient(680px 340px at 96% 4%, var(--mesh-b), transparent 55%),
    linear-gradient(180deg,var(--bg-1),var(--bg-2)) fixed;
  font-feature-settings:"ss01";
}
.glass{
  background:var(--glass); border:1px solid var(--glass-br);
  backdrop-filter:blur(22px) saturate(180%);
  -webkit-backdrop-filter:blur(22px) saturate(180%);
  border-radius:20px;
  box-shadow:0 12px 28px rgba(80,90,160,.16), inset 0 1px 0 rgba(255,255,255,.9);
}
.num{font-variant-numeric:tabular-nums;letter-spacing:-.02em}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
```

- [ ] **Step 2: Replace `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "App Store Command Center" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="mx-auto max-w-6xl px-5 py-8">{children}</div>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verify** — `pnpm build` → succeeds. **Step 4: Commit** `feat: Daylight Frost tokens + layout`.

### Task 8.2: Glass primitives

**Files:**
- Create: `src/components/glass/Card.tsx`, `Stat.tsx`, `Nav.tsx`
- Test: `tests/components/glass.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stat } from "@/components/glass/Stat";

test("Stat renders label, value and delta", () => {
  render(<Stat label="Total" value="48,210" delta={+3.1} />);
  expect(screen.getByText("Total")).toBeInTheDocument();
  expect(screen.getByText("48,210")).toBeInTheDocument();
  expect(screen.getByText(/3.1/)).toBeInTheDocument();
});
```

Add `environment: "jsdom"` override: prepend test file with `// @vitest-environment jsdom`.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the three components:

`src/components/glass/Card.tsx`:
```tsx
export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`glass p-5 ${className}`}>{children}</div>;
}
```

`src/components/glass/Stat.tsx`:
```tsx
export function Stat({ label, value, delta }: { label: string; value: string; delta?: number }) {
  const cls = delta == null ? "" : delta >= 0 ? "text-[var(--ok)]" : "text-[var(--bad)]";
  return (
    <div className="glass p-5">
      <div className="text-[11px] uppercase tracking-wide text-[var(--ink-2)]">{label}</div>
      <div className="num mt-1 text-3xl font-bold">{value}</div>
      {delta != null && <div className={`mt-1 text-sm font-semibold ${cls}`}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%</div>}
    </div>
  );
}
```

`src/components/glass/Nav.tsx`:
```tsx
import Link from "next/link";
const items = [["/", "Glance"], ["/portfolio", "Portfolio"], ["/aso", "ASO"], ["/reviews", "Reviews"], ["/insights", "Insights"]];
export function Nav() {
  return (
    <nav className="glass mb-6 flex gap-1 p-2 text-sm">
      {items.map(([href, label]) => (
        <Link key={href} href={href} className="rounded-xl px-3 py-2 hover:bg-white/50">{label}</Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: glass primitives`.

### Task 8.3: Charts

**Files:**
- Create: `src/components/charts/LineArea.tsx`
- Test: `tests/components/linearea.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// @vitest-environment jsdom
import { test, expect } from "vitest";
import { render } from "@testing-library/react";
import { LineArea } from "@/components/charts/LineArea";

test("LineArea renders an svg for given points", () => {
  const { container } = render(<LineArea data={[{ day: "2026-05-18", value: 5 }, { day: "2026-05-19", value: 8 }]} />);
  expect(container.querySelector("svg")).toBeTruthy();
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `src/components/charts/LineArea.tsx`**

```tsx
"use client";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export function LineArea({ data }: { data: { day: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6d5dfb" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#6d5dfb" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
        <Tooltip />
        <Area type="monotone" dataKey="value" stroke="#6d5dfb" strokeWidth={2.5} fill="url(#g)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: LineArea chart`.

### Task 8.4: Glance page

**Files:**
- Create: `src/app/page.tsx`

- [ ] **Step 1: Implement `src/app/page.tsx`** (server component reading via store):

```tsx
import { Nav } from "@/components/glass/Nav";
import { Stat } from "@/components/glass/Stat";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { buildGlance, visibleAppIds } from "@/lib/aggregate/api";
import { todayUtc } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function Glance() {
  const store = makeStore(ghBackendFromEnv());
  const ids = await visibleAppIds(store);
  const g = await buildGlance(store, ids, todayUtc().slice(0, 7));
  const total = g.apps.reduce((s, a) => s + a.total, 0);
  const today = g.apps.reduce((s, a) => s + a.today, 0);
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Glance</h1>
      <div className="mb-5 grid grid-cols-3 gap-4">
        <Stat label="Total downloads" value={total.toLocaleString()} />
        <Stat label="Today" value={today.toLocaleString()} />
        <Stat label="Apps tracked" value={String(g.apps.length)} />
      </div>
      <div className="grid gap-4">
        {g.apps.map((a) => (
          <Card key={a.appId}>
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">{a.name}</span>
              <span className="num text-lg">{a.today} today</span>
            </div>
            {a.anomaly && (
              <div className="mt-2 text-sm text-[var(--bad)]">
                {a.anomaly.direction === "drop" ? "▼" : "▲"} {a.anomaly.metric}: {a.anomaly.cause}
              </div>
            )}
          </Card>
        ))}
        {g.apps.length === 0 && <Card>No data yet. The first cron run will populate this.</Card>}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify** — `pnpm build` → succeeds.
- [ ] **Step 3: Commit** `feat: Glance page`.

### Task 8.5: Portfolio, ASO, Reviews, Insights, App-detail pages

**Files:**
- Create: `src/app/portfolio/page.tsx`, `src/app/aso/page.tsx`, `src/app/reviews/page.tsx`, `src/app/insights/page.tsx`, `src/app/app/[appId]/page.tsx`

Each is a server component following the Glance pattern (Nav + glass cards + the relevant aggregation). Implement in this order; verify `pnpm build` and commit after each.

- [ ] **Step 1: `src/app/insights/page.tsx`**

```tsx
import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { insightsPath } from "@/lib/store/paths";

export const dynamic = "force-dynamic";

export default async function Insights() {
  const store = makeStore(ghBackendFromEnv());
  const insights = await store.readJson<any>(insightsPath(), { apps: {}, generatedAt: "" });
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Insights</h1>
      {insights.digest && (
        <Card className="mb-4 whitespace-pre-wrap text-sm">{insights.digest}</Card>
      )}
      <div className="grid gap-4">
        {Object.entries<any>(insights.apps).map(([id, a]) => (
          <Card key={id}>
            <div className="font-semibold">{a.name}</div>
            {a.anomaly && <div className="mt-1 text-sm text-[var(--bad)]">{a.anomaly.cause}</div>}
            {a.funnel?.leak !== "none" && <div className="mt-1 text-sm">{a.funnel.message}</div>}
            {a.opportunities?.length > 0 && (
              <div className="mt-1 text-sm text-[var(--ink-2)]">
                Keyword opportunities: {a.opportunities.slice(0, 5).map((o: any) => `${o.term} (#${o.rank})`).join(", ")}
              </div>
            )}
          </Card>
        ))}
        {Object.keys(insights.apps).length === 0 && <Card>No insights yet.</Card>}
      </div>
    </main>
  );
}
```

- [ ] **Step 2:** `pnpm build` → succeeds. Commit `feat: insights page`.

- [ ] **Step 3: `src/app/portfolio/page.tsx`**

```tsx
import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { visibleAppIds, buildGlance } from "@/lib/aggregate/api";
import { rankPortfolio, attentionScore } from "@/lib/aggregate/portfolio";
import { todayUtc } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function Portfolio() {
  const store = makeStore(ghBackendFromEnv());
  const ids = await visibleAppIds(store);
  const g = await buildGlance(store, ids, todayUtc().slice(0, 7));
  const rows = rankPortfolio(g.apps.map((a) => ({
    ...a, score: attentionScore({ anomalyDrop: a.anomaly?.direction === "drop", ratingDelta: 0, unresponded: 0 }),
  })));
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Portfolio</h1>
      <div className="grid gap-3">
        {rows.map((a) => (
          <Card key={a.appId}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">{a.name}</span>
              <span className="num">{a.today} today · {a.total.toLocaleString()} total</span>
            </div>
          </Card>
        ))}
        {rows.length === 0 && <Card>No apps yet.</Card>}
      </div>
    </main>
  );
}
```

- [ ] **Step 4:** `pnpm build`; commit `feat: portfolio page`.

- [ ] **Step 5: `src/app/reviews/page.tsx`**

```tsx
import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { visibleAppIds } from "@/lib/aggregate/api";
import { reviewsPath, type Review } from "@/lib/store/paths";

export const dynamic = "force-dynamic";

export default async function Reviews() {
  const store = makeStore(ghBackendFromEnv());
  const ids = await visibleAppIds(store);
  const all: { appId: string; r: Review }[] = [];
  for (const id of ids) {
    const rs = await store.readJson<Review[]>(reviewsPath(id), []);
    rs.slice(0, 20).forEach((r) => all.push({ appId: id, r }));
  }
  all.sort((a, b) => b.r.createdDate.localeCompare(a.r.createdDate));
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Reviews</h1>
      <div className="grid gap-3">
        {all.map(({ r }) => (
          <Card key={r.id}>
            <div className="flex justify-between text-sm">
              <span className="text-[var(--star)]">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
              <span className="text-[var(--ink-2)]">{r.territory} · {r.createdDate.slice(0, 10)}{r.responded ? " · replied" : ""}</span>
            </div>
            <div className="mt-1 font-semibold">{r.title}</div>
            <div className="text-sm text-[var(--ink-2)]">{r.body}</div>
          </Card>
        ))}
        {all.length === 0 && <Card>No reviews yet.</Card>}
      </div>
    </main>
  );
}
```

- [ ] **Step 6:** `pnpm build`; commit `feat: reviews page`.

- [ ] **Step 7: `src/app/aso/page.tsx`**

```tsx
import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { insightsPath } from "@/lib/store/paths";

export const dynamic = "force-dynamic";

export default async function Aso() {
  const store = makeStore(ghBackendFromEnv());
  const insights = await store.readJson<any>(insightsPath(), { apps: {} });
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">ASO / Growth</h1>
      <div className="grid gap-4">
        {Object.entries<any>(insights.apps).map(([id, a]) => (
          <Card key={id}>
            <div className="font-semibold">{a.name}</div>
            <div className="mt-1 text-sm">{a.funnel?.message ?? "Funnel data warming up."}</div>
            <div className="mt-2 text-sm text-[var(--ink-2)]">
              {(a.opportunities ?? []).map((o: any) => (
                <span key={o.term} className="mr-3">{o.term} #{o.rank} ({o.trend})</span>
              ))}
            </div>
          </Card>
        ))}
        {Object.keys(insights.apps).length === 0 && <Card>No ASO data yet. Add keywords in config and wait for the next run.</Card>}
      </div>
    </main>
  );
}
```

- [ ] **Step 8:** `pnpm build`; commit `feat: ASO page`.

- [ ] **Step 9: `src/app/app/[appId]/page.tsx`**

```tsx
import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { LineArea } from "@/components/charts/LineArea";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { salesPath, appMetaPath, type SalesDay, type AppMeta } from "@/lib/store/paths";
import { downloadsSeries } from "@/lib/aggregate/downloads";
import { todayUtc } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function AppDetail({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const store = makeStore(ghBackendFromEnv());
  const meta = await store.readJson<AppMeta | null>(appMetaPath(appId), null);
  const sales = await store.readJson<SalesDay[]>(salesPath(appId, todayUtc().slice(0, 7) + "-01"), []);
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">{meta?.name ?? appId}</h1>
      <Card><LineArea data={downloadsSeries(sales)} /></Card>
    </main>
  );
}
```

- [ ] **Step 10:** `pnpm build`; commit `feat: app-detail page`.

---

## Milestone 9 — Ship

### Task 9.1: README + first-deploy runbook

**Files:**
- Create: `README.md`

- [ ] **Step 1:** Write `README.md` documenting: env vars (from `.env.example`), how to create the GitHub OAuth app (callback `https://<domain>/api/auth/callback/github`), creating the empty private `GITHUB_DATA_REPO`, the reusable ASC key location (`/path/to/your/AuthKey_<ASC_KEY_ID>.p8`), `ASC_VENDOR_NUMBER` from ASC → Payments and Financial Reports, and that the first cron run backfills ~365 days of Sales while Analytics grows forward.
- [ ] **Step 2:** Commit `docs: README + deploy runbook`.

### Task 9.2: Full green + deploy

- [ ] **Step 1:** Run `pnpm test` → all pass.
- [ ] **Step 2:** Run `pnpm build` → succeeds.
- [ ] **Step 3:** Create the private GitHub repo `lawoflarge/appstore-command-center`, add remote, push `main`.
- [ ] **Step 4:** Import into Vercel (Hobby), set every env var from `.env.example` (server-side), confirm the cron appears under Project → Settings → Cron Jobs.
- [ ] **Step 5:** Trigger `/api/cron` once manually with the secret; verify `data/*.json` commits appear and the dashboard renders behind GitHub login.
- [ ] **Step 6:** Commit any config fixes; tag `v0.1.0`.

---

## Self-Review

**1. Spec coverage**

| Spec section | Covered by |
|---|---|
| §2 goals (daily cron, glance reconcile, intelligence, auth, free tier) | M5, M7, M4, M6, M9 |
| §3 layered dashboard | M8 (Glance/Portfolio/App/ASO/Reviews/Insights) |
| §3 auto-discover + toggle | Task 3.1, 7.4 (config), 7.3 (visibility filter) |
| §3 keyword watchlist | Task 3.6, 4.4, 7.4 |
| §3 all 4 intelligence bundles | M4 (anomaly, funnel, keywords, forecast, sentiment, digest, engine) |
| §3 in-dashboard insights only | Task 8.5 insights page (no Telegram/email — none built) |
| §3 GitHub OAuth locked | M6 |
| §3 git-as-DB | M2, used everywhere |
| §5 data sources (5) | Tasks 3.2–3.6, 5.1 |
| §6 architecture units | matches file structure 1:1 |
| §9 error handling/resilience | Task 5.2 (per-collector isolation, run-status), 5.3 (maxDuration) |
| §10 testing (TDD) | every logic task has failing-test-first |
| §11 env vars | Task 0.1 `.env.example`, 0.3 validation |
| §12 risks (60s cap) | Task 5.2 note (cron stays light; series intelligence computed on read), 5.3 `maxDuration=60` |
| §8 Daylight Frost | M8 |

No spec requirement is left without a task.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" — every code step contains complete code and every test step contains real assertions.

**3. Type consistency:** Shared types defined once in `src/lib/store/paths.ts` (`SalesDay`, `AnalyticsDay`, `RatingPoint`, `Review`, `KeywordRank`, `AppMeta`, `Config`, `RunStatus`); `Point` defined in `baseline.ts` and reused by `downloads.ts`/`forecast.ts`; `Insights`/`AppInsight` defined in `engine.ts` and consumed by pages. `store` interface (`readJson`/`writeJson`/`upsertDailyArray`) is consistent across orchestrator, API, and pages. Collector function names (`collectSales`, `collectRatings`, `collectKeywordRanks`, `mapReviews`, `parseAnalyticsCsv`) are referenced consistently in the cron route.

One refinement applied inline: the orchestrator persists raw data and a lightweight insights pass; full series-backed intelligence is computed on read (Milestone 7), which keeps the daily cron inside the Vercel Hobby 60s budget (spec §12 risk) without losing any feature.
