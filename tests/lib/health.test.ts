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
