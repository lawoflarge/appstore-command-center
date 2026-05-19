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
