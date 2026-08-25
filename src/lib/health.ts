// A dead GITHUB_DATA_TOKEN used to surface as Next's bare "Application error: a
// server-side exception has occurred" — the digest alone said nothing, and the same
// outage repeats every time a fine-grained PAT hits its expiry date. /api/health probes
// the data repo with one cheap request and this classifier turns the HTTP status into a
// cause the error page can name.
export type ProbeReason =
  | "ok" | "token-invalid" | "token-lacks-access" | "rate-limited" | "unexpected";

export interface DataRepoProbe {
  ok: boolean;
  status: number;
  reason: ProbeReason;
  /** GitHub echoes a fine-grained PAT's expiry on every API response. Null for classic PATs. */
  tokenExpiresAt: string | null;
  /** Core-API requests left in this hour, from x-ratelimit-remaining. Null if not sent. */
  rateRemaining: number | null;
  hint: string;
}

const HINTS: Record<ProbeReason, string> = {
  ok: "The data repo is reachable.",
  "token-invalid":
    "GITHUB_DATA_TOKEN is expired or revoked. Issue a new fine-grained PAT with " +
    "Contents: read and write on the data repo and update the Vercel env var.",
  "token-lacks-access":
    "GITHUB_DATA_TOKEN no longer covers the data repo. Check that the PAT lists this " +
    "repository and grants Contents: read and write.",
  "rate-limited":
    "GitHub's API quota for this token is exhausted. It refills within the hour.",
  unexpected: "GitHub answered with an unexpected status.",
};

// A single probe request succeeds on the last of the hourly quota, so a bare 200 says only
// "this one request worked" — during the 2026-08-25 outage that read as healthy while every
// page still threw. Below this many requests, the probe names the budget rather than claiming
// the repo is simply fine.
const LOW_QUOTA = 1000;

export function classifyDataRepoProbe(
  status: number, headers: { get(name: string): string | null },
): DataRepoProbe {
  const tokenExpiresAt = headers.get("github-authentication-token-expiration");
  const rawRemaining = headers.get("x-ratelimit-remaining");
  const rateRemaining = rawRemaining === null || rawRemaining === "" ? null : Number(rawRemaining);
  let reason: ProbeReason;
  if (status === 200) reason = "ok";
  else if (status === 401) reason = "token-invalid";
  // A fine-grained PAT that doesn't cover the repo gets 404, not 403 — GitHub hides
  // private repos from tokens that can't see them.
  else if (status === 404) reason = "token-lacks-access";
  else if (status === 403) {
    reason = headers.get("x-ratelimit-remaining") === "0" ? "rate-limited" : "token-lacks-access";
  } else reason = "unexpected";
  let hint = HINTS[reason];
  if (reason === "ok" && rateRemaining !== null && rateRemaining < LOW_QUOTA) {
    hint = `The data repo is reachable, but only ${rateRemaining} GitHub API requests remain ` +
      "this hour. Reads start failing once that reaches zero; the quota refills within the hour.";
  }
  return { ok: reason === "ok", status, reason, tokenExpiresAt, rateRemaining, hint };
}
