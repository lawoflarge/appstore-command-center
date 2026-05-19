import { test, expect, vi } from "vitest";

test("cron route rejects without CRON_SECRET", async () => {
  vi.stubGlobal("process", { ...process, env: { ...process.env, CRON_SECRET: "s3cret" } });
  const { GET } = await import("@/app/api/cron/route");
  const res = await GET(new Request("http://x/api/cron"));
  expect(res.status).toBe(401);
});
