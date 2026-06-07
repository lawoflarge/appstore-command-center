# CLAUDE.md — agent boot context

Project-specific instructions for Claude Code. Read this first; then the README for setup and `docs/superpowers/specs/...` for the design rationale.

## What this is

Private, single-user dashboard pulling App Store Connect data daily, running rules-based intelligence (anomaly / funnel / keyword / forecast), storing raw data as partitioned JSON in a separate private "data" repo (git-as-DB). Zero recurring cost — no DB, no LLM, Vercel Hobby.

- **Live:** https://appstore-command-center.vercel.app
- **Code repo (public):** https://github.com/lawoflarge/appstore-command-center
- **Data repo (private):** `lawoflarge/appstore-command-center-data` — JSON committed by the daily cron; treated as a database, never edited by hand.
- **Cron:** Vercel `0 6 * * *` → `/api/cron` (guarded by `CRON_SECRET`).

## Hard constraints — do not break

1. **pnpm only.** Lockfile is `pnpm-lock.yaml`. Do not introduce `package-lock.json` or `yarn.lock`.
2. **Node 20.** Matches Vercel runtime.
3. **Vercel Hobby 60s function cap.** Cron must finish within 60s. Per-app collectors run in parallel via `Promise.all` (`src/lib/orchestrator.ts`). Adding sequential work here will trip the cap.
4. **Zero LLM dependencies.** Anthropic-driven review clustering + weekly digest were intentionally removed (commit `c7ef791`) to keep operating cost at $0. Do not reintroduce LLM calls without explicit approval.
5. **Secrets stay server-side.** ASC `.p8` private key (`ASC_PRIVATE_KEY`) and all OAuth/data-repo tokens are read only in server code. Never expose to the client bundle.
6. **Single-user auth.** `signIn` callback in `src/lib/auth/config.ts` rejects everyone except `ALLOWED_GITHUB_LOGIN`. Edge middleware gates every page except `/api/auth/*` and `/api/cron`.

## Module map

```
src/app/                  Next.js App Router pages (one folder = one route)
  api/                    /api/cron + /api/auth/[...nextauth] + /api/config + /api/data + /api/dashboards/[id]
  app/[appId]/            per-app detail (configurable chart dashboard)
  aso/                    keyword-rank watchlist
  insights/               anomaly / funnel / forecast surface
  portfolio/              cross-app ranking
  revenue/                AdMob ad-revenue charts (earnings/impressions/requests/eCPM; day·month·lifetime)
  reviews/                cross-app review feed
  settings/               per-app hide + keyword editor

src/components/
  glass/                  Card, Nav, Stat — Daylight Frost glass tokens
  charts/viz/             7 viz components (Area, MultiLine, StackedArea, Bar, Funnel, SmallMultiples, Heatmap) + VizRenderer dispatcher
  dashboard/              ConfigurableDashboard grid + ChartCardFrame + CardEditor slide-over
  settings/               per-app settings rows

src/lib/
  asc/                    ASC client + ES256 JWT minting (jwt.ts, client.ts)
  sources/                5 per-app collectors: sales, analytics, reviews, ratings, keywords (+ apps discovery) + admob (account-wide ad revenue, optional ADMOB_* env)
  store/                  GitHub Contents API write layer (retry-on-409), path helpers
  aggregate/              compute-on-read aggregations + buildSeries (series.ts) + loadRawBundle (rawBundle.ts) + buildRevenue (revenue.ts: AdMob + ASC proceeds → unified)
  dashboards/             ChartCard types, defaults, zod schema, metric × viz compatibility matrix
  intelligence/           anomaly, funnel, keywords, forecast, engine (rules-based, no LLM)
  auth/config.ts          Auth.js v5 GitHub provider + allowlist
  orchestrator.ts         cron entrypoint: discover → 5 collectors per app in parallel → intelligence pass
  dates.ts                native UTC date math (no date-fns)
```

## Conventions

- **Git-as-DB schema.** `data/<appId>/<source>/<YYYY-MM>.json` in the data repo. Append-only — collectors merge into the current-month file. Never mutate prior months.
- **Concurrent commits.** Writes use retry-on-409 backoff (`src/lib/store/github.ts`). When adding new write paths, route through this — never call the Contents API directly.
- **Empty CSV / empty page is normal day-0.** Apple has ~24h publication lag; ANGOING Analytics reports take ~24h after first creation. Expect zeros for the first 24–48h; surface honest empty states, never fake fixture data.
- **Lint is strict.** `pnpm build` fails on lint errors. `@typescript-eslint/no-explicit-any` is off only at the I/O boundary (ASC / GitHub responses); elsewhere it's on.
- **Tests:** `pnpm test` — Vitest, ~66 tests. Add fixtures next to the unit under test; jsdom-safe rendering for chart tests.

## Gotchas (real ones, learned the hard way)

- **ASC `analyticsReports/instances`:** ASC rejects a `sort` query param here; also use single-page fetch — multi-page paginated requests blow the 60s cap (`b713f58`, `ee47c53`).
- **JWT signing:** ASC requires **ES256** with the `.p8` EC private key. `jsonwebtoken` works fine; key must be the actual PEM contents with real newlines at runtime — env var stores `\n` literals that get unescaped in `src/lib/asc/jwt.ts`.
- **iTunes Search API rank:** records *storefront search-result position* for watched terms. Trend signal only — not ASA rank, not exact organic rank. README documents this honestly; do not overclaim in UI copy.
- **PII history scrub:** the public repo was filtered with `git-filter-repo` before going public (commit `fc2fe7f`). If you commit anything that looks identifying, expect a re-scrub.
- **Codemagic / mobile builds:** unrelated to this repo — this is a Next.js web project only.
- **Downloads come from analytics, not sales.** These are free apps: Apple's daily SALES TSV is empty (and lags), so `series.ts` resolves the `downloads` metric analytics-first with a sales fallback, and `buildGlance` does the same. Don't re-point downloads at sales.
- **Sales report date lag.** The cron requests the SALES report for day-1…day-5 (first non-empty), never today — today's report isn't published yet. This is what makes `proceedsUsd` / IAP revenue flow.
- **Analytics rows are filed by their OWN month, not today's.** Apple's analytics report is a rolling multi-day window; near a month boundary it includes late-previous-month days. The orchestrator partitions `aDays` by `r.day.slice(0,7)` and writes each to `analyticsPath(id, r.day)` (the sales write already did this). Dumping the whole window into today's month file duplicated those days across two month files → double-counted in funnel/breakdown reads (they `+=` every row) and stale last-write-wins elsewhere. Defense-in-depth on read: `loadRawBundle` and `buildGlance` filter every month file with `rowsInMonth(rows, monthStart)` so a day is canonical to exactly one file.
- **Glance pins every app to one shared latest day.** `buildGlance` finds the global max data day across apps, then reports each app's value AT that day — `today` is `number | null`, null when that app has no row for the reference day yet. The UI renders null as "N/A". Never show an app's own older latest-day value under the global date label: that made the summary contradict the chart (an app stuck on Jun 5 showed "4" while the chart had no Jun 6 point). The chart side: `MultiLine` maps a missing day to `null` + `connectNulls={false}` so a lagging series shows a gap, not a plunge to 0.
- **Session / active-device / crash analytics are NOT collected.** Apple only emits "App Sessions Standard" / "App Store Installation and Deletion Standard" / "App Crashes" instances above a usage threshold these low-volume apps don't meet (verified live 2026-05-31 — all returned "no daily instance"). Adding those collectors = dead code + cron cost for zero data. The `sessions`/`activeDevices`/`deletions`/`crashes` fields on `AnalyticsDay` stay 0 by design.

## Things explicitly NOT to do

- Don't add a database. The whole premise is git-as-DB.
- Don't add LLM features. See constraint #4.
- Don't commit `.env*` except `.env.example`. `.gitignore` already enforces; double-check after large refactors.
- Don't push directly to `main` from an agent session unless I say so. Default: branch + PR. ([[feedback_agent_git_guardrail]] in my memory.)
- Don't run `npm install` or `yarn install` — they'll generate a foreign lockfile that breaks Vercel.

## Local-only files NOT in this repo

Gitignored, but real and needed if you're trying to **run** locally (not just build):

| Path | What | How to get it |
|---|---|---|
| `.env.local` | Real prod secrets (ASC key, OAuth, data-repo PAT, AUTH_SECRET, CRON_SECRET) | Transfer out-of-band from the Windows machine via password manager. **Never via this repo or any chat.** |
| `archive/` | One-off deploy/setup scripts and notes (`sanitize.py`, `seed-keywords.py`, `setup.py`, `wait-and-verify.py`, `generated-secrets.env`). Useful history; not required to run. | Copy from the Windows machine if you want them; nothing in `src/` depends on them. |
| `.superpowers/brainstorm/` | Pre-build brainstorm HTML artifacts. Already distilled into `docs/superpowers/specs/` and `docs/superpowers/plans/`. Safe to ignore. | — |

## First-time setup on a new machine

```bash
git clone https://github.com/lawoflarge/appstore-command-center.git
cd appstore-command-center
pnpm install
cp .env.example .env.local
# fill .env.local from your password manager — see README "Environment variables"
pnpm test     # 110 tests should pass without any env vars
pnpm build    # lint + typecheck + production build
pnpm dev      # http://localhost:3000 — most pages empty until cron has run on prod
```

For ASC key + OAuth app + data repo + Vercel import steps, see **README → Setup** (10-step walkthrough). Do not duplicate those steps here.

## Where to look first

- Live design intent: `docs/superpowers/specs/2026-05-19-appstore-command-center-design.md`
- Full implementation plan (122 KB, the actual build log): `docs/superpowers/plans/2026-05-19-appstore-command-center.md`
- Configurable charts (added 2026-05-26): `docs/superpowers/specs/2026-05-24-configurable-charts-design.md` + `docs/superpowers/plans/2026-05-24-configurable-charts.md`
- User-facing setup + env vars: `README.md`
