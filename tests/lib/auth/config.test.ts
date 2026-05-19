import { test, expect } from "vitest";
import { isAllowed } from "@/lib/auth/config";

test("isAllowed only passes the configured login", () => {
  expect(isAllowed({ login: "lawoflarge" }, "lawoflarge")).toBe(true);
  expect(isAllowed({ login: "someone" }, "lawoflarge")).toBe(false);
  expect(isAllowed(null, "lawoflarge")).toBe(false);
});
