import { test, expect } from "vitest";
import apps from "../../fixtures/asc-apps.json";
import { discoverApps } from "@/lib/sources/apps";

test("discoverApps maps ASC app records", async () => {
  const result = await discoverApps(async () => apps as any, "2026-05-19");
  expect(result).toEqual([
    { appId: "6767226388", name: "Example App One", bundleId: "com.example.appone", sku: "EXAMPLE1", firstSeen: "2026-05-19", hidden: false, archived: false, releases: [] },
    { appId: "6480000000", name: "Example App Two", bundleId: "com.example.apptwo", sku: "EXAMPLE2", firstSeen: "2026-05-19", hidden: false, archived: false, releases: [] },
  ]);
});
