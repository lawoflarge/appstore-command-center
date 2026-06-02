import { test, expect } from "vitest";
import { config } from "@/middleware";

test("middleware matcher excludes auth + cron + static", () => {
  const pattern = config.matcher[0];
  // The security-relevant exclusions: auth + cron stay public, everything else is gated.
  // (Static assets / PWA manifest / icons are also excluded — listed but not pinned here
  // so adding a static path doesn't break this test.)
  expect(pattern).toContain("api/auth");
  expect(pattern).toContain("api/cron");
  expect(pattern).toContain("_next/static");
});
