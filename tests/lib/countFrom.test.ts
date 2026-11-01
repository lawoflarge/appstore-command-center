import { test, expect } from "vitest";
import {
  countFromMap, onOrAfter, reviewsOnOrAfter, lifetimeFrom, subscriptionsOnOrAfter, loadCountFrom,
} from "@/lib/countFrom";
import type { Review, SubscriptionSnapshot } from "@/lib/store/paths";

// A transferred app counts only from the day it became ours (see src/lib/countFrom.ts).
const CUTOFF = "2026-11-01";

test("countFromMap returns only the apps that carry a countFrom", () => {
  const map = countFromMap({ apps: {
    "1": { hidden: false, archived: false, keywords: [], countFrom: CUTOFF },
    "2": { hidden: false, archived: false, keywords: [] },
  } });
  expect(map).toEqual({ "1": CUTOFF });
});

test("loadCountFrom reads data/config.json and falls back to no cutoffs", async () => {
  const withCfg = { readJson: async (p: string, fb: unknown) => p === "data/config.json"
    ? { apps: { "1": { hidden: false, archived: false, keywords: [], countFrom: CUTOFF } } } : fb };
  expect(await loadCountFrom(withCfg as any)).toEqual({ "1": CUTOFF });
  const empty = { readJson: async (_p: string, fb: unknown) => fb };
  expect(await loadCountFrom(empty as any)).toEqual({});
});

test("onOrAfter keeps the cutoff day itself and drops every earlier day", () => {
  const rows = [{ day: "2026-10-18" }, { day: "2026-10-31" }, { day: "2026-11-01" }, { day: "2026-11-02" }];
  expect(onOrAfter(rows, CUTOFF).map((r) => r.day)).toEqual(["2026-11-01", "2026-11-02"]);
});

test("onOrAfter returns the very same array when the app has no cutoff (other apps stay untouched)", () => {
  const rows = [{ day: "2026-05-18" }, { day: "2026-10-31" }];
  expect(onOrAfter(rows, undefined)).toBe(rows);
});

test("reviewsOnOrAfter filters on the review's own calendar date", () => {
  const review = (id: string, createdDate: string): Review => ({
    id, rating: 5, title: "", body: "", reviewer: "", territory: "USA", createdDate, responded: false,
  });
  const reviews = [review("old", "2026-10-31T23:59:59-07:00"), review("new", "2026-11-01T00:00:01-07:00")];
  expect(reviewsOnOrAfter(reviews, CUTOFF).map((r) => r.id)).toEqual(["new"]);
  expect(reviewsOnOrAfter(reviews, undefined)).toBe(reviews);
});

test("lifetimeFrom starts lifetime totals at the later of firstSeen and countFrom", () => {
  expect(lifetimeFrom("2026-10-15", CUTOFF)).toBe(CUTOFF);
  expect(lifetimeFrom("2026-11-05", CUTOFF)).toBe("2026-11-05");
  expect(lifetimeFrom("2026-05-18", undefined)).toBe("2026-05-18");
});

test("subscriptionsOnOrAfter drops an app's products from snapshots dated before its cutoff", () => {
  const product = (appAppleId: string) => ({
    appName: appAppleId, appAppleId, subscriptionName: "s", subscriptionAppleId: `${appAppleId}-s`, subscriptionGroupId: "g",
    duration: "1 Week", counts: { standardPrice: 1, freeTrial: 0, paidOffer: 0, marketingOptIn: 0, gracePeriod: 0, billingRetry: 0 },
  });
  const snap = (reportDate: string): SubscriptionSnapshot => ({
    reportDate, collectedAt: "2026-11-02T00:00:00Z", source: "SUBSCRIPTION/SUMMARY 1_3", products: [product("1"), product("2")],
  });
  expect(subscriptionsOnOrAfter(snap("2026-10-31"), { "1": CUTOFF })!.products.map((p) => p.appAppleId)).toEqual(["2"]);
  expect(subscriptionsOnOrAfter(snap(CUTOFF), { "1": CUTOFF })!.products.map((p) => p.appAppleId)).toEqual(["1", "2"]);
  const untouched = snap("2026-10-31");
  expect(subscriptionsOnOrAfter(untouched, {})).toBe(untouched);
  expect(subscriptionsOnOrAfter(null, { "1": CUTOFF })).toBeNull();
});
