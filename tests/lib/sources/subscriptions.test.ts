import { afterEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { ascFetchSubscriptionsTsv, collectSubscriptionsInto, newerSubscriptionSnapshot, parseSubscriptionSnapshot } from "@/lib/sources/subscriptions";
import { makeStore, type GhBackend } from "@/lib/store/store";
import { subscriptionsPath, type SubscriptionSnapshot } from "@/lib/store/paths";

vi.mock("@/lib/asc/jwt", () => ({ signAscToken: () => "synthetic-test-token" }));
afterEach(() => vi.unstubAllGlobals());

// Synthetic report fields mirror Apple's public schema; no private sales values or identities.
function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "App Name": "Sample App", "App Apple ID": "100", "Subscription Name": "Sample Monthly",
    "Subscription Apple ID": "101", "Subscription Group ID": "102", "Standard Subscription Duration": "1 Month",
    "Active Standard Price Subscriptions": "2", "Active Free Trial Introductory Offer Subscriptions": "0",
    "Active Pay Up Front Introductory Offer Subscriptions": "0", "Active Pay As You Go Introductory Offer Subscriptions": "0",
    "Free Trial Promotional Offer Subscriptions": "0", "Pay Up Front Promotional Offer Subscriptions": "0", "Pay As You Go Promotional Offer Subscriptions": "0",
    "Free Trial Offer Code Subscriptions": "0", "Pay Up Front Offer Code Subscriptions": "0", "Pay As You Go Offer Code Subscriptions": "0",
    "Marketing Opt-Ins": "0", "Billing Retry": "0", "Grace Period": "0", "Subscribers": "",
    "Free Trial Win-back Offers": "0", "Pay Up Front Win-back Offers": "0", "Pay As You Go Win-back Offers": "0",
    ...overrides,
  };
}
function inMemoryStore(initial?: SubscriptionSnapshot) {
  let current = initial ?? null;
  const gh: GhBackend = {
    async get<T>() { return current ? { value: current as T, sha: "test-sha" } : null; },
    async put(_path, value) { current = value as SubscriptionSnapshot; },
  };
  return { store: makeStore(gh), read: () => current };
}

describe("subscription stock reports", () => {
  it("groups regional rows by product and keeps paid/trial/offer/billing states separate", () => {
    const snapshot = parseSubscriptionSnapshot([
      row({ Country: "DE", "Active Free Trial Introductory Offer Subscriptions": "3", "Grace Period": "1", "Billing Retry": "4" }),
      row({ Country: "US", "Free Trial Offer Code Subscriptions": "2", "Pay As You Go Win-back Offers": "5", "Marketing Opt-Ins": "1" }),
    ], "2026-10-08", "2026-10-10T12:00:00Z");
    expect(snapshot.products).toHaveLength(1);
    expect(snapshot.products[0].counts).toEqual({ standardPrice: 4, freeTrial: 5, paidOffer: 5, marketingOptIn: 1, gracePeriod: 1, billingRetry: 4 });
    expect(snapshot.products[0]).not.toHaveProperty("subscribers");
  });

  it("rejects a blank required count instead of silently calling it zero", () => {
    expect(() => parseSubscriptionSnapshot([row({ "Billing Retry": "" })], "2026-10-08")).toThrow("invalid count");
  });

  it("selects only the newest available report instead of summing snapshots", async () => {
    const data = inMemoryStore();
    const fetch = vi.fn(async (day: string) => day === "2026-10-09" ? null : [row()]);
    const result = await collectSubscriptionsInto(fetch, data.store, "2026-10-10");
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(result).toMatchObject({ ok: true, reportDate: "2026-10-08" });
    expect(data.read()!.products[0].counts.standardPrice).toBe(2);
  });

  it("preserves the last valid snapshot on unavailable, failed and malformed reports", async () => {
    const previous = parseSubscriptionSnapshot([row()], "2026-10-07", "2026-10-08T00:00:00Z");
    for (const fetch of [async () => null, async () => { throw new Error("offline"); }, async () => [{ error: "schema changed" }]]) {
      const data = inMemoryStore(previous);
      expect((await collectSubscriptionsInto(fetch, data.store, "2026-10-10")).ok).toBe(false);
      expect(data.read()).toEqual(previous);
    }
  });

  it("accepts a valid header-only report as zero stock", async () => {
    const data = inMemoryStore(parseSubscriptionSnapshot([row()], "2026-10-07"));
    expect((await collectSubscriptionsInto(async () => [], data.store, "2026-10-10")).ok).toBe(true);
    expect(data.read()!.products).toEqual([]);
    expect(data.read()!.reportDate).toBe("2026-10-09");
  });

  it("does not replace a newer stored report with an older result", async () => {
    const previous = parseSubscriptionSnapshot([row({ "Active Standard Price Subscriptions": "7" })], "2026-10-09");
    const data = inMemoryStore(previous);
    await collectSubscriptionsInto(async (day) => day === "2026-10-09" ? null : [row()], data.store, "2026-10-10");
    expect(data.read()).toEqual(previous);
    expect(newerSubscriptionSnapshot(previous, { ...previous, collectedAt: "2000-01-01T00:00:00Z" })).toEqual(previous);
  });

  it("uses official v1_3, a bounded fetch and distinguishes not-published from valid empty", async () => {
    const header = Object.keys(row()).join("\t") + "\n";
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(gzipSync(header)));
    vi.stubGlobal("fetch", fetch);
    const load = ascFetchSubscriptionsTsv({} as never, "synthetic-vendor");
    expect(await load("2026-10-09")).toBeNull();
    expect(await load("2026-10-08")).toEqual([]);
    const [url, init] = fetch.mock.calls[0];
    const q = new URL(url).searchParams;
    expect(q.get("filter[version]")).toBe("1_3");
    expect(q.get("filter[reportType]")).toBe("SUBSCRIPTION");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(subscriptionsPath()).toBe("data/subscriptions/latest.json");
  });
});
