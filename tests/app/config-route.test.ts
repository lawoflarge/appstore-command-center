import { test, expect } from "vitest";
import { applyConfigPatch } from "@/app/api/config/logic";

test("applyConfigPatch sets visibility + keywords per app", () => {
  const next = applyConfigPatch({ apps: {} }, { appId: "1", hidden: true, keywords: [{ term: "x", country: "de" }] });
  expect(next.apps["1"]).toEqual({ hidden: true, archived: false, keywords: [{ term: "x", country: "de" }] });
});

// countFrom (app transfer cutoff) is set by hand in data/config.json and is not editable from
// Settings. Saving keywords or visibility must keep it: dropping it would let the next collection
// write the previous owner's history again.
test("applyConfigPatch keeps an app's countFrom when Settings patches it", () => {
  const cfg = { apps: { "1": { hidden: false, archived: false, keywords: [], countFrom: "2026-11-01" } } };
  const next = applyConfigPatch(cfg, { appId: "1", keywords: [{ term: "expense tracker", country: "us" }] });
  expect(next.apps["1"].countFrom).toBe("2026-11-01");
  expect(applyConfigPatch(cfg, { appId: "1", hidden: true }).apps["1"].countFrom).toBe("2026-11-01");
});
