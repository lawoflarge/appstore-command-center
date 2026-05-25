import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(async () => ({ user: { name: "operator" } })),
}));

const storeJson: { value: { byId: Record<string, unknown> } } = { value: { byId: {} } };
vi.mock("@/lib/store/store", () => ({
  ghBackendFromEnv: () => ({}),
  makeStore: () => ({
    readJson: async () => storeJson.value,
    writeJson: async (_p: string, v: unknown) => { storeJson.value = v as typeof storeJson.value; },
  }),
}));

import { GET, POST } from "@/app/api/dashboards/[id]/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/dashboards/[id]", () => {
  beforeEach(() => { storeJson.value = { byId: {} }; });

  it("GET returns defaults for glance when missing", async () => {
    const res = await GET(new Request("http://x"), ctx("glance"));
    const body = await res.json();
    expect(Array.isArray(body.cards)).toBe(true);
    expect(body.cards.length).toBe(4);
  });

  it("POST writes a valid slice and returns updatedAt", async () => {
    const body = {
      cards: [{
        id: "c1", title: "T", metric: "downloads", viz: "area", appIds: "all",
        range: "7d", bucket: "day", breakdown: "none", compare: "none",
      }],
      updatedAt: new Date().toISOString(),
    };
    const res = await POST(new Request("http://x", {
      method: "POST", body: JSON.stringify(body),
    }), ctx("glance"));
    expect(res.status).toBe(200);
    expect(storeJson.value.byId["glance"]).toBeDefined();
  });

  it("POST rejects an invalid body with 400", async () => {
    const res = await POST(new Request("http://x", {
      method: "POST", body: JSON.stringify({ cards: [{ id: "x" }] }),
    }), ctx("glance"));
    expect(res.status).toBe(400);
  });
});
