# App Store Command Center

A private, single-user dashboard that pulls App Store Connect data daily and turns it into a monitoring + growth tool for **your own** iOS apps. Built to run on Vercel's free tier with **zero recurring cost** — no database, no LLM bills, no SaaS. Daily Vercel Cron auto-discovers every app on your Apple Developer account, runs five collectors (sales, analytics funnel, reviews, ratings, keyword-rank), and commits the raw data as partitioned JSON into a separate private git repo used as the database. A rules-based intelligence layer surfaces anomalies, funnel leaks, keyword opportunities, and a month-end forecast.

> Designed for the case "I run a handful of iOS apps and want one dashboard instead of bouncing between App Store Connect, Sensor Tower, and a spreadsheet." Not a competitor-tracker, not an MMP — just **your apps**, end-to-end honest.

## Why this exists

App Store Connect's web UI is fine for one-off lookups and useless as a daily driver. Real third-party stacks start at \$50–\$200/month and assume you're running an ad budget. This project is the middle path: an opinionated dashboard you self-host on Vercel Hobby for free, that pulls exactly the same numbers Apple gives you, sliced the way you want.

## What it shows

| Page | What you see |
|------|-------------|
| **Glance** | Latest-day downloads against one shared reference day (apps Apple hasn't published yet show **N/A**, never a stale number), this-month totals, blended rating, top anomaly per app |
| **Portfolio** | Cross-app ranking by attention score (anomaly + rating delta + unresponded reviews) |
| **Revenue** | Unified revenue (AdMob ad earnings + App Store in-app & subscription proceeds), with the in-app/subscription proceeds broken down **by app** and **by day**, plus AdMob by day/month/app/ad-unit |
| **App detail** | Daily sales sparkline, funnel, ratings trend, reviews list per app |
| **ASO** | iTunes-Search rank tracker per watched keyword + country |
| **Reviews** | Cross-app review feed, filterable by rating/territory/responded |
| **Insights** | Day-of-week anomaly detection with probable cause, funnel-leak diagnosis, keyword opportunity finder, month-end forecast with confidence band |
| **Settings** | Per-app hide/archive + keyword watchlist editor |

## Honest caveats

- The keyword layer uses the free public iTunes Search API — it records where your app appears in storefront search results for watched terms. It's a valid trend signal, **not** ASA-paid rank and **not** exact organic rank.
- **Day-0 expectation:** Apple's Sales Reports have a ~24h publication lag. Analytics ONGOING report requests take ~24h after first creation to publish their first instance. Expect mostly zeros for the first 24-48 hours, real signal from the second daily cron onwards.
- **Shared latest day:** Glance pins every app to one reference day (the freshest day any app has). Apps Apple hasn't published that day for yet show **N/A** rather than their own older value, so the summary and the chart never contradict each other. In-app proceeds revenue is reported by Apple as a money amount, not a transaction count, so the Revenue tab breaks down proceeds (not number of purchases).
- **Vercel Hobby 60s function cap.** The cron parallelizes per-app and fits ~10 apps comfortably; beyond that you may need to split it.
- **One user.** Auth is locked to a single GitHub username via the `signIn` callback. Not built for teams.

## Architecture

```
Vercel Cron (0 6 * * *)
  → /api/cron (guarded by CRON_SECRET)
    → discover all apps via ASC GET /v1/apps
    → run 5 collectors PER APP IN PARALLEL (sales, analytics, reviews, ratings, keywords)
    → commit partitioned JSON to the data repo (data/<appId>/<source>/<YYYY-MM>.json)
    → intelligence pass (anomaly, funnel, keyword opportunities, forecast)
    → commit insights.json + run-status.json
```

**Git as database.** All collected data lives in a separate private repo as JSON files committed via the GitHub Contents API. No external DB — immune to free-tier database pauses, the whole audit trail of every collection is in git history, and you can clone the data repo locally for offline analysis. Writes use retry-on-409 for concurrent-safety.

**Auth.** Auth.js v5 with GitHub OAuth. The `signIn` callback rejects everyone except the configured `ALLOWED_GITHUB_LOGIN`. Edge middleware gates every page except `/api/auth/*` and `/api/cron`.

## Local dev

Targets Node 20.

```bash
pnpm install
pnpm test          # Vitest unit suite (66 tests)
pnpm build         # Next.js production build (lint errors fail the build)
pnpm dev           # http://localhost:3000
```

Most pages will be empty locally until the cron has run at least once and committed JSON to your configured data repo. All data access depends on the environment variables below.

## Environment variables

Copy `.env.example` to `.env.local` (server-side only — none are exposed to the client bundle):

| Variable | What it is | How to get it |
|---|---|---|
| `ASC_KEY_ID` | Key ID of your App Store Connect API key | ASC → Users and Access → Integrations → Keys (top-right) → the 10-char Key ID next to your key |
| `ASC_ISSUER_ID` | Issuer ID for your team | Same page, shown above the keys list (UUID) |
| `ASC_PRIVATE_KEY` | Contents of the downloaded `.p8` file as a single string with **literal `\n`** for newlines | When you create the key, ASC offers a one-time `.p8` download. Open it in a text editor and replace real newlines with the two characters `\n` so it fits on one env var line. Include the `-----BEGIN/END PRIVATE KEY-----` markers. |
| `ASC_VENDOR_NUMBER` | Your ASC vendor/provider number (account-level) | ASC → Payments and Financial Reports → top of page (7-10 digits) |
| `GITHUB_OAUTH_CLIENT_ID` | OAuth App client ID for dashboard login | Create a GitHub OAuth App (see setup below) |
| `GITHUB_OAUTH_CLIENT_SECRET` | OAuth App client secret | Same OAuth App; generate then copy |
| `AUTH_SECRET` | Secret used by Auth.js to sign session cookies | `openssl rand -base64 32` |
| `ALLOWED_GITHUB_LOGIN` | The single GitHub username allowed to sign in | Your GitHub handle |
| `GITHUB_DATA_REPO` | `owner/repo` of the separate private repo used as JSON data store | `<your-handle>/appstore-command-center-data` |
| `GITHUB_DATA_TOKEN` | Fine-grained PAT with `contents:write` on the data repo | Settings → Developer settings → Personal access tokens → Fine-grained tokens |
| `GITHUB_DATA_BRANCH` | Branch in the data repo (usually `main`) | `main` |
| `CRON_SECRET` | Shared secret guarding `/api/cron` | `openssl rand -hex 24` |
| `NEXTAUTH_URL` | Full public URL of the dashboard | `http://localhost:3000` locally, your Vercel URL in prod |

## Setup

1. **Fork this repo** to your own GitHub account.
2. **Create the data repo.** New empty private repo, do not initialize with a README. This is your `GITHUB_DATA_REPO`.
3. **Create a fine-grained PAT** scoped only to the data repo with `Contents: read and write`. This is your `GITHUB_DATA_TOKEN`.
4. **Create a GitHub OAuth App.** Settings → Developer settings → OAuth Apps → New OAuth App. Callback: `https://<your-vercel-domain>/api/auth/callback/github`. Copy client ID + generate client secret.
5. **Create an ASC API key.** App Store Connect → Users and Access → Integrations → Keys → "+". Role: Admin or Developer. Download the `.p8` **(one-time download, save it carefully)**.
6. **Import into Vercel.** Add New Project → import your fork → Hobby plan. Add every env var above (server-side). Deploy.
7. **Verify the cron job.** Vercel project → Settings → Cron Jobs should show `0 6 * * *` → `/api/cron`.
8. **Trigger the first run.** `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron` — expect `{"ok": true, ...}`, then check the data repo for fresh commits.
9. **Sign in.** Visit `https://<your-domain>`, sign in with the GitHub account matching `ALLOWED_GITHUB_LOGIN`, land on Glance.
10. **Add keywords.** `/settings` page → per app, add 3-5 terms with their target country. The ASO page starts having data the next time the cron runs.

## Known limitations

- **Vercel Hobby 60s function cap.** Comfortable for ~10 apps. Beyond that, split the cron.
- **Cron timing is approximate.** Hobby crons fire roughly once per day near the scheduled time, not at exact 6:00 UTC. Acceptable — the goal is daily cadence, not precision.
- **Analytics funnel grows forward only.** Apple's ONGOING reports have ~365-day retention; no way to backfill funnel/conversion history. Sales history backfills ~365 days immediately on first run.
- **Published Apple developer legal name** is associated with the `.p8` key and visible in App Store listings — Apple platform constraint, not something this dashboard controls.

## Tech

Next.js 15 (App Router, TypeScript), pnpm, Vitest, Tailwind v4, Auth.js v5 (GitHub provider), Recharts, `jsonwebtoken` (ES256 for ASC JWT), `zod`, native UTC date math, GitHub REST Contents API. Lint: `@typescript-eslint/no-explicit-any` off at the I/O boundary, every other rule active.

## Why each design choice

- **Git as DB**: serverless-friendly, immune to free-tier pauses, full audit trail, cheap to clone for offline analysis. The price is sequential commits — solved with retry-on-409 backoff.
- **Per-app parallelization**: each app writes disjoint paths, so `Promise.all` across apps is safe and brings 4-app wall-clock from 60s+ down to ~30s.
- **No LLM dependency**: review clustering + weekly digest were dropped to keep operating cost at $0. Reviews are still collected and listed.
- **Single-user OAuth allowlist**: simplest possible auth that's not "no auth". For multi-user, swap the `signIn` callback for a real ACL.

## License

MIT — see [LICENSE](LICENSE).

## Reference documents

- Design spec: [`docs/superpowers/specs/2026-05-19-appstore-command-center-design.md`](docs/superpowers/specs/2026-05-19-appstore-command-center-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-05-19-appstore-command-center.md`](docs/superpowers/plans/2026-05-19-appstore-command-center.md)
