# App Store Command Center

## What it is

A private, single-user Next.js dashboard on Vercel that pulls App Store Connect data for every iOS app on the account daily and turns it into a layered monitoring and growth tool. A daily Vercel Cron auto-discovers all apps, runs five isolated collectors (sales, analytics, reviews, ratings, keyword-rank), and commits dated JSON to a separate private git repo used as the database — no external database required and no silent pauses. A pure-function intelligence engine plus batched Anthropic calls derives anomaly flags, funnel-leak diagnoses, and a weekly AI digest; all insights surface in an in-dashboard Insights center only (no email or push). Access is locked to one GitHub account via GitHub OAuth.

**Honest caveats up front:**

- The keyword layer is a free iTunes Search rank watchlist — it records where your app appears in storefront search results for watched terms, not ASA-paid rank or competitor tracking. It is a valid trend signal, not an exact organic rank.
- Sales data backfills approximately 365 days of daily history the moment the first cron runs. Analytics funnel data (impressions, conversion, retention) starts empty and grows forward from the day the ONGOING report request is created; expect 1-2 days before funnel rows appear.

---

## Local dev

**Node version:** The project targets Node 20 (as declared in `@types/node ^20`). Use `nvm use 20` or equivalent.

```bash
pnpm install
pnpm test          # Vitest unit suite
pnpm build         # Next.js production build (lint errors fail the build)
pnpm dev           # http://localhost:3000
```

Most pages will be empty or show loading states locally until the cron has run at least once and committed JSON to the data repo. All data access and authentication depend on the environment variables below.

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in every variable. All variables are server-side only — none are exposed to the client bundle.

| Variable | What it is | How to get it |
|---|---|---|
| `ASC_KEY_ID` | The key ID portion of your App Store Connect API key | App Store Connect → Users and Access → Integrations → Keys; the Key ID shown next to the key (yours: `<ASC_KEY_ID>`) |
| `ASC_ISSUER_ID` | The Issuer ID for your App Store Connect team | Same page, shown above the keys list (yours: `<ASC_ISSUER_ID>`) |
| `ASC_PRIVATE_KEY` | The full contents of the `.p8` key file as a single string with literal `\n` for newlines | The reusable key file is at `/path/to/your/AuthKey_<ASC_KEY_ID>.p8`; paste the file contents with `-----BEGIN PRIVATE KEY-----` header and footer, replacing actual newlines with the two characters `\n` |
| `ASC_VENDOR_NUMBER` | Your App Store Connect vendor/provider number (account-level) | App Store Connect → Payments and Financial Reports → top of the page |
| `GITHUB_OAUTH_CLIENT_ID` | OAuth App client ID for dashboard login | Create a GitHub OAuth App (see first-deploy runbook); copy the Client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | OAuth App client secret | Same OAuth App; generate and copy the Client Secret |
| `AUTH_SECRET` | Secret used by Auth.js to sign session cookies | Run `openssl rand -base64 32` |
| `ALLOWED_GITHUB_LOGIN` | The single GitHub username allowed to sign in | Your GitHub handle (e.g. `lawoflarge`) |
| `GITHUB_DATA_REPO` | `owner/repo` of the separate private repo used as the JSON data store | Create an empty private repo (see first-deploy runbook); format: `lawoflarge/appstore-command-center-data` |
| `GITHUB_DATA_TOKEN` | GitHub PAT with `contents:write` on the data repo | Create a fine-grained PAT scoped only to the data repo with read + write on Contents |
| `GITHUB_DATA_BRANCH` | Branch in the data repo where JSON is committed | `main` (or whatever the default branch of your data repo is) |
| `ANTHROPIC_API_KEY` | Anthropic API key for the review clustering and weekly digest | console.anthropic.com → API Keys |
| `CRON_SECRET` | Shared secret that guards the `/api/cron` route | Run `openssl rand -hex 24` |
| `NEXTAUTH_URL` | Full public URL of the dashboard (used by Auth.js) | `http://localhost:3000` for local dev; your Vercel deployment URL in production (e.g. `https://appstore-command-center.vercel.app`) |

---

## First-deploy runbook

These are steps you perform once before (and during) the first Vercel deployment.

1. **Create the data repo.** On GitHub, create a new **empty private** repository for the JSON data store — for example `lawoflarge/appstore-command-center-data`. Do not initialize it with a README; the cron will create files on first run. This is your `GITHUB_DATA_REPO`.

2. **Create a PAT for the data repo.** Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens. Create a token scoped only to the data repo with **Contents: read and write** permission. This is your `GITHUB_DATA_TOKEN`. Copy it now — it is shown only once.

3. **Push the app code to its own private repo.** Create a second private repo on GitHub (e.g. `lawoflarge/appstore-command-center`) for the dashboard source. Push `feat/implementation` (or merge to main first, per your workflow) to that repo.

4. **Create a GitHub OAuth App for dashboard login.** Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App. Set:
   - Homepage URL: your Vercel deployment URL (you can use a placeholder and update after deploy)
   - Authorization callback URL: `https://<your-vercel-domain>/api/auth/callback/github`

   Copy the **Client ID** and generate a **Client Secret**. These are `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`.

5. **Import into Vercel.** Go to vercel.com, click **Add New Project**, import the app code repo. Choose the **Hobby** plan. Before deploying, go to **Environment Variables** and add every variable from the table above as **server-side** (not exposed to browser). Deploy.

6. **Verify the cron job.** After deploy, go to your Vercel project → **Settings → Cron Jobs**. You should see one entry: `0 6 * * *` → `/api/cron`. Vercel reads this from `vercel.json`. Vercel will automatically attach `Authorization: Bearer $CRON_SECRET` to scheduled invocations.

7. **Manually trigger the first run.** Do not wait for 6 AM UTC. Run:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron
   ```
   Or using the query-string form if you prefer:
   ```bash
   curl "https://<your-domain>/api/cron?key=$CRON_SECRET"
   ```
   Expect a JSON response like `{ "ok": true, ... }`. After the run completes, check the data repo on GitHub — you should see new commits adding `data/<appId>/...` JSON files.

8. **Sign in and verify pages render.** Visit `https://<your-domain>` and sign in with the GitHub account matching `ALLOWED_GITHUB_LOGIN`. Check:
   - Glance page shows download totals and ratings.
   - Portfolio page lists your apps.
   - Any app detail page shows sales time series.

9. **Analytics funnel ramp note.** The first cron run creates the ONGOING Analytics report request with Apple. Funnel data (impressions, conversion, retention) will not appear until Apple generates the first report instance, typically 1-2 days later. The UI displays "funnel data warming up" rather than zeros during this period. Sales data (downloads history) is available immediately after the first run.

---

## Architecture

### Daily pipeline

```
Vercel Cron (0 6 * * *)
  → /api/cron (guarded by CRON_SECRET)
    → discover all apps (GET /v1/apps)
    → run 5 collectors in isolation (sales, analytics, reviews, ratings, keyword-rank)
    → commit partitioned JSON to data repo (data/<appId>/<source>/<YYYY-MM>.json)
    → intelligence pass (anomaly, funnel, keywords, forecast, sentiment, digest)
    → commit insights.json + run-status.json
```

Each collector is independently best-effort — a failure in one does not block the others. The orchestrator is resumable: it tracks progress in `run-status.json` so a re-triggered run continues rather than starts over.

### git-as-DB

All data lives in the separate private data repo as JSON files. The layout is:

```
data/
  <appId>/
    <source>/
      <YYYY-MM>.json
    meta.json
  config.json       (watchlist keywords, per-app visibility)
  insights.json
  run-status.json
```

Reads go through the GitHub Contents API (authenticated fetch), never the local filesystem — Vercel serverless has a read-only build-snapshot filesystem so locally-committed data would not appear without a redeploy. The data-access layer wraps reads with Next.js `revalidate` cache and in-memory memoization to stay within GitHub API rate limits.

Writes use `PUT /repos/{owner}/{repo}/contents/{path}` and are idempotent — re-running a day overwrites that day's slice.

### Auth

Auth.js v5 (next-auth beta) with the GitHub provider. The `signIn` callback rejects every account except `ALLOWED_GITHUB_LOGIN`. Edge middleware gates all routes except the auth callback and the cron route.

### Intelligence engine

Pure functions for anomaly detection (day-of-week-aware trailing-28-day baseline, z-score), funnel-leak diagnosis (names the stage where conversion drops below the app's own trailing baseline), keyword opportunities (watchlist terms ranking 8-25 or trending), and a seasonal-naive month-end forecast with a confidence band from residual variance. Review clustering and the weekly narrative digest use the Anthropic API with batched, cheap model calls on only new reviews since the last run.

### Tech stack

Next.js 15 App Router, TypeScript, pnpm, Vitest, Tailwind CSS v4, Auth.js v5 (next-auth beta), Recharts (full charts) + hand-rolled SVG sparklines, `@anthropic-ai/sdk`, `jsonwebtoken` (ES256 ASC JWT), `zod`, `date-fns`, Node `zlib`.

Lint posture: `@typescript-eslint/no-explicit-any` is disabled in `eslint.config.mjs` — external ASC, iTunes, and LLM JSON is intentionally typed as `any` at the I/O boundary. All other lint rules are active and enforced at build.

### Reference documents

- Design spec: `docs/superpowers/specs/2026-05-19-appstore-command-center-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-19-appstore-command-center.md`

---

## Known limitations

- **Vercel Hobby 60-second function cap.** The cron orchestrator runs within a single serverless function invocation. On accounts with many apps or large analytics backlogs it may time out. The orchestrator is designed resumable (via `run-status.json`) so a re-trigger continues where it left off. If it consistently times out, the plan calls for splitting into multiple cron endpoints.
- **Cron timing is approximate.** Vercel Hobby crons fire roughly once per day near the scheduled time; do not rely on exact 6:00 UTC execution. This is acceptable — the requirement is daily cadence, not precision scheduling.
- **Keyword layer is an approximation.** The keyword-rank collector uses the public iTunes Search API to record where your app appears in the first 200 results for each watched term. This is a storefront-search approximation, not exact organic rank and not ASA-paid rank. It is a free, valid trend signal.
- **Analytics funnel grows forward only.** Apple's Analytics Reports API uses ONGOING report requests with approximately 365-day retention. There is no way to backfill funnel/conversion/retention history beyond Apple's retention window. Sales history backfills ~365 days immediately.
- **jose / next-auth edge runtime warning.** You may see a benign warning about `jose` in edge runtime on startup. The dashboard uses default JWT sessions; the JWE encryption path is unused. The warning does not affect functionality.
- **Published Apple developer legal name.** Your Apple developer account legal name is visible in App Store listings and associated with the `.p8` key. This is an Apple platform constraint, not something this dashboard controls.
