# App Store Command Center — Design Spec

- **Date:** 2026-05-19
- **Owner:** the operator
- **Status:** Approved (brainstorm) → pending implementation plan
- **Project dir:** `/path/to/appstore-command-center`

## 1. Purpose

A private, single-user web dashboard, hosted on Vercel, that pulls the operator's App
Store Connect data daily and turns it into a holistic monitoring + growth tool
for all of his iOS apps. It must not just display charts — it must tell him
what changed, why, and what to do to grow downloads.

## 2. Goals & success criteria

1. A daily Vercel Cron collects data for **every app auto-discovered** under the
   Apple account and commits dated JSON to the repo (git-as-DB), idempotently
   and re-runnably.
2. The **Glance** screen reconciles total downloads, today's downloads, the
   day-over-day delta, and average rating to App Store Connect within rounding.
3. Each of the four intelligence bundles produces its core artifact, verifiable
   against synthetic fixtures (anomaly flag, funnel-leak stage, review themes,
   month-end forecast).
4. **Only** the allowlisted GitHub account can load any page; the ASC `.p8`
   private key never reaches the client bundle.
5. Deploys and runs within Vercel free-tier (Hobby) limits.

## 3. Decisions locked in brainstorm

| Topic | Decision |
|---|---|
| Product shape | Layered: Glance home + Portfolio tab + deep ASO/Growth/Reviews/Insights |
| App scope | Auto-discover all apps on the Apple account; per-app show/hide/archive toggle |
| Keyword layer | Free rank-watchlist via public iTunes Search API (no competitor tracking) |
| Intelligence | All four bundles (Anomaly/what-changed, Growth/ASO, Reviews, Forecast/AI digest) |
| Alerts | In-dashboard insights center only (no Telegram, no email) |
| Access control | GitHub OAuth, allowlisted to the operator's single GitHub account |
| Storage | git-as-DB: partitioned JSON committed to the repo, compute-on-read |
| Visual direction | "Daylight Frost" — bright airy light-mode liquid glass |

## 4. Non-goals (v1, deliberately cut)

- Telegram / email / push delivery — the in-dashboard insights center is the only channel.
- Competitor keyword/rank tracking — deferred (was mentioned in the Growth bundle; removed for scope coherence with the keyword decision).
- Any paid third-party ASO API (AppTweak / Sensor Tower / Appfigures).
- Multi-user / sharing / roles.
- Dark mode (Daylight Frost is the only theme for v1).
- Android / Google Play.
- Real-time / intraday refresh — daily only.
- Backfilling Analytics/funnel history beyond Apple's retention window.

## 5. Data sources (free-tier only; honest about limits)

| Source | Provides | Mechanism | Notes |
|---|---|---|---|
| ASC **Sales Reports** API | downloads, redownloads, updates, proceeds, refunds, by country/device | `GET /v1/salesReports` DAILY/SALES/SUMMARY, gzipped TSV | Reliable. **Backfills ~365 days of daily history at launch** — immediate download history. |
| ASC **Analytics Reports** API | impressions, product page views, conversion rate, sessions, active devices, retention, crashes, acquisition source | `analyticsReportRequests` (ONGOING) → reports → instances → segments (gzipped CSV) | First data ~1–2 days after the ONGOING request is created. **Grows forward only**, ~365-day retention. |
| ASC **Customer Reviews** API | rating, title, body, reviewer nickname, territory, created date, developer responses | `GET /v1/apps/{id}/customerReviews` paginated, sort by `-createdDate`; `customerReviewResponses` for replies | Public per-country RSS feed is the no-auth fallback. |
| **iTunes Lookup** API (public) | average rating + rating count, per country | `https://itunes.apple.com/lookup?id={id}&country={c}` | No auth; safe to poll often. Source of truth for the rating gauge. |
| **iTunes Search** API (public) | app's rank position for a watchlist keyword + country | `https://itunes.apple.com/search?term={t}&country={c}&entity=software&limit=200` | Storefront-search approximation of organic rank — a real, free proxy, not exact ASA ranking. |

**Auth:** all ASC endpoints use a JWT signed with the existing shared `.p8`
key (`KEY_ID <ASC_KEY_ID>`, `ISSUER <ASC_ISSUER_ID>`,
Apple Team `<APPLE_TEAM_ID>` — covers every app on the account). The key file is at
`/path/to/your/AuthKey_<ASC_KEY_ID>.p8`; in production its
contents live only in a Vercel server-side env var.

## 6. Architecture

Next.js (App Router, TypeScript) on Vercel. Isolated, independently testable units:

### 6.1 `asc-client` (shared)
JWT (ES256) signing from the `.p8`, request execution, cursor pagination,
gzip/TSV/CSV decoding. Input: signed request descriptor. Output: parsed rows.
No business logic.

### 6.2 Collectors (one module per source)
`collect-sales`, `collect-analytics`, `collect-reviews`, `collect-ratings`,
`collect-keyword-rank`. Contract: **input** = `{ apps, dateRange, config }`,
**output** = normalized JSON for the run. Each is best-effort and isolated — a
failure in one never blocks the others. `collect-analytics` is also responsible
for ensuring an ONGOING `analyticsReportRequest` exists per app (creates it if
missing) before pulling instances.

### 6.3 `store` (git-as-DB)
- **Write:** commit/update JSON via the GitHub Contents API
  (`PUT /repos/{owner}/{repo}/contents/{path}`) using a PAT env var. Layout:
  `data/<appId>/<source>/<YYYY-MM>.json`, `data/<appId>/meta.json`,
  `data/config.json` (watchlist keywords, per-app visibility), `data/insights.json`,
  `data/run-status.json`.
- **Read:** authenticated fetch of those JSON blobs via the GitHub API,
  wrapped in a single data-access layer with Next.js cache (`revalidate`) +
  in-memory memoization. **Reads must not use the local filesystem** — Vercel
  serverless has a read-only, build-time-snapshot FS, so freshly committed data
  would not appear without a redeploy. The GitHub-API read path makes new data
  visible without redeploying.
- Writes are **idempotent**: re-running a day overwrites that day's slice.

### 6.4 `cron-orchestrator`
A Vercel Cron-triggered route (guarded by `CRON_SECRET`). Steps: discover apps
→ run collectors → commit normalized JSON → run the intelligence pass → commit
`insights.json` + `run-status.json`. Designed **resumable**: progress is tracked
in `run-status.json` so a re-run continues rather than restarts.

### 6.5 `intelligence` engine (pure functions + LLM)
- **Anomaly / what-changed:** day-of-week-aware trailing-28-day baseline; flag
  z-score deviations; attach probable-cause heuristics (proximity to an app
  release date, storefront availability gap, data-collection gap).
- **Funnel diagnosis:** impressions → page views → installs conversion vs the
  app's own trailing baseline; name the leaking stage.
- **Keyword opportunities:** watchlist terms where rank sits in the 8–25 band
  or is trending; surfaced as "one push from page 1".
- **Forecast:** seasonal-naive / linear trend → month-end projection with a
  confidence band from residual variance. Intentionally simple, no ML.
- **Review sentiment + weekly digest:** Anthropic API. Cheap model clusters
  only *new* reviews since the last run into themes; the weekly run produces a
  narrative digest with a prioritized action list. Batched; tiny cost.

### 6.6 Web app, API, auth
- Auth.js (NextAuth v5) GitHub provider; `signIn` callback rejects every
  account except `ALLOWED_GITHUB_LOGIN`; JWT session cookie.
- Edge middleware gates all routes except the auth callback and the
  `CRON_SECRET`-guarded cron route.
- Read-only API routes serve aggregates from the `store` data-access layer.
- Config mutations (watchlist keywords, app visibility) are authenticated API
  routes that write `data/config.json` back through `store`.

## 7. Screens

1. **Glance** — total + today downloads, deltas, blended rating, and the top
   ranked "what changed" cards across all visible apps.
2. **Portfolio** — every auto-discovered app as a glass row, ranked by an
   attention score (anomaly severity + rating drop + review backlog); per-app
   show/hide/archive toggle.
3. **App detail** — downloads/proceeds time series, country breakdown, device
   split, release markers, retention.
4. **ASO / Growth** — the impressions→views→installs funnel with the leak
   highlighted; keyword-rank watchlist charts; keyword opportunities; geo
   opportunities.
5. **Reviews & reputation** — rating trend, review stream, sentiment themes,
   unanswered queue with one-click reply drafts, review→backlog extraction.
6. **Insights center** — the persistent inbox of every generated insight,
   anomaly, and the weekly AI digest; read/dismiss state.

## 8. Design system — "Daylight Frost"

- **Background:** layered radial mesh — `#d9e4ff` top-left, `#ffe1ec`
  top-right — over a `#eef1fb → #e7ebf7` vertical base.
- **Glass surfaces:** `background rgba(255,255,255,.62)`, `border 1px
  rgba(255,255,255,.85)`, `backdrop-filter blur(22px) saturate(180%)`,
  `box-shadow 0 12px 28px rgba(80,90,160,.16)` + inset top highlight,
  radius 16–24px.
- **Color:** ink `#1c2030`, secondary `#5b6178`, accent violet `#6d5dfb`,
  success `#16a34a`, danger `#e11d48`, star `#f59e0b`.
- **Typography:** SF Pro / system stack; `font-variant-numeric: tabular-nums`
  for all metrics; tight negative tracking on display numerals.
- **Motion:** spring easing `cubic-bezier(.2,.8,.2,1)`; subtle hover lift;
  honor `prefers-reduced-motion`.
- **Charts:** themed — violet line, soft area gradient, no heavy gridlines.
- **Accessibility requirement:** frosted glass over a bright mesh is a known
  contrast hazard. Text/number panels must keep enough panel opacity and ink
  darkness to meet WCAG AA contrast; this is a hard acceptance criterion, not a
  nice-to-have.
- Charting: one lightweight library (Recharts) for full charts; hand-rolled SVG
  for sparklines. Keep dependency surface minimal.

## 9. Error handling & resilience

- Per-collector best-effort; partial days are written and flagged.
- Analytics ramp/lag tolerated — funnel history grows forward; the UI states
  when funnel data is not yet available rather than showing zeros.
- Idempotent, resumable daily writes via `run-status.json`.
- The cron writes a run-status record that surfaces directly as the
  "silent-failure watch" insight, including EU-storefront-blocked detection
  (reuses the `contentStatuses` / iTunes-lookup signal pattern).
- git-as-DB means there is no database to be silently paused (the Supabase
  free-tier-pause lesson).

## 10. Testing (TDD)

- Collectors against recorded fixture payloads (captured ASC/iTunes responses).
- Intelligence functions unit-tested with synthetic series carrying known
  anomalies, known funnel leaks, and known forecast targets.
- `store` read/write round-trip tests (mocked GitHub API).
- Auth middleware test: non-allowlisted GitHub account is rejected on every route.

## 11. Environment variables (all server-side)

`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY` (the `.p8` contents),
`ASC_VENDOR_NUMBER`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`,
`AUTH_SECRET`, `ALLOWED_GITHUB_LOGIN`, `GITHUB_DATA_REPO`, `GITHUB_DATA_TOKEN`
(PAT to commit data), `ANTHROPIC_API_KEY`, `CRON_SECRET`.

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Vercel Hobby function duration cap (~60s) vs collection time | Resumable, chunked-per-app orchestrator; Sales is fast, Analytics only fetches already-generated instances; split into multiple cron endpoints if it grows |
| Vercel Hobby cron cadence is approximate (~once/day, loose timing) | Acceptable — requirement is daily, not a precise time |
| ASC Analytics 1–2 day ramp before first funnel data | UI explicitly shows "funnel data warming up" instead of zeros |
| iTunes Search rank ≠ exact organic/ASA rank | Documented in-UI as an approximation; still a valid free trend signal |
| Glass-on-bright contrast/accessibility | Hard WCAG-AA acceptance criterion in the design system |
| GitHub API rate limits on data reads | Aggressive caching: Next `revalidate` + in-memory memoization in the data-access layer |

## 13. Deployment

- New private repo under `lawoflarge` (proposed: `lawoflarge/appstore-command-center`).
- Local working dir: `/path/to/appstore-command-center`.
- Vercel project on the free Hobby plan; daily cron via `vercel.json`.
- `.superpowers/`, `.env*`, `node_modules`, `.next` git-ignored.
