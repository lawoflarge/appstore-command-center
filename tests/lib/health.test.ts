import { test, expect } from "vitest";
import { classifyDataRepoProbe } from "@/lib/health";

function hdrs(map: Record<string, string> = {}) {
  return { get: (n: string) => map[n.toLowerCase()] ?? null };
}

test("200 is healthy and carries the token expiry when GitHub sends one", () => {
  const p = classifyDataRepoProbe(200, hdrs({
    "github-authentication-token-expiration": "2026-11-19 12:00:00 UTC",
  }));
  expect(p.ok).toBe(true);
  expect(p.reason).toBe("ok");
  expect(p.tokenExpiresAt).toBe("2026-11-19 12:00:00 UTC");
});

test("401 reads as an expired or revoked token", () => {
  const p = classifyDataRepoProbe(401, hdrs());
  expect(p.ok).toBe(false);
  expect(p.reason).toBe("token-invalid");
  expect(p.hint).toMatch(/GITHUB_DATA_TOKEN/);
});

// A fine-grained PAT that no longer covers the data repo 404s rather than 403s.
test("404 reads as a token without access to the data repo", () => {
  expect(classifyDataRepoProbe(404, hdrs()).reason).toBe("token-lacks-access");
});

test("403 with an exhausted quota reads as rate limiting, not as a bad token", () => {
  const p = classifyDataRepoProbe(403, hdrs({ "x-ratelimit-remaining": "0" }));
  expect(p.reason).toBe("rate-limited");
});

test("403 with quota left reads as missing permissions", () => {
  expect(classifyDataRepoProbe(403, hdrs({ "x-ratelimit-remaining": "4999" })).reason)
    .toBe("token-lacks-access");
});

test("anything else stays unexpected instead of guessing", () => {
  expect(classifyDataRepoProbe(502, hdrs()).reason).toBe("unexpected");
});

// The outage of 2026-08-25 (digest 192268049) probed as a healthy 200 while every page was
// still throwing: one HEAD request succeeds on the last of the hourly quota, so "reachable"
// answered a narrower question than the error page was asking. The probe reports the
// remaining budget so a nearly-exhausted token can't read as fine.
test("a healthy probe reports the remaining API quota", () => {
  const p = classifyDataRepoProbe(200, hdrs({ "x-ratelimit-remaining": "4821" }));
  expect(p.ok).toBe(true);
  expect(p.rateRemaining).toBe(4821);
  expect(p.hint).toBe("The data repo is reachable.");
});

test("a 200 on a nearly-exhausted quota says so instead of just 'reachable'", () => {
  const p = classifyDataRepoProbe(200, hdrs({ "x-ratelimit-remaining": "12" }));
  expect(p.ok).toBe(true);
  expect(p.rateRemaining).toBe(12);
  expect(p.hint).toMatch(/12/);
  expect(p.hint).toMatch(/quota|requests/i);
});

test("rateRemaining is null when GitHub sends no quota header", () => {
  expect(classifyDataRepoProbe(200, hdrs()).rateRemaining).toBeNull();
});
