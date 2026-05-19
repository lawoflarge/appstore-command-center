import { test, expect } from "vitest";
import { applyConfigPatch } from "@/app/api/config/logic";

test("applyConfigPatch sets visibility + keywords per app", () => {
  const next = applyConfigPatch({ apps: {} }, { appId: "1", hidden: true, keywords: [{ term: "x", country: "de" }] });
  expect(next.apps["1"]).toEqual({ hidden: true, archived: false, keywords: [{ term: "x", country: "de" }] });
});
