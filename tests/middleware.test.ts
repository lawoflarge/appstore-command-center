import { test, expect } from "vitest";
import { config } from "@/middleware";

test("middleware matcher excludes auth + cron + static", () => {
  expect(config.matcher).toContain("/((?!api/auth|api/cron|_next/static|_next/image|favicon.ico).*)");
});
