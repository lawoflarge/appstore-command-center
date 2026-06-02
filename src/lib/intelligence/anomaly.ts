import { zScore, type Point } from "./baseline";

export interface Anomaly {
  appId: string; metric: string; day: string;
  direction: "spike" | "drop"; z: number; value: number; baseline: number; cause: string;
  nearRelease: boolean;
}

export function detectAnomalies(input: {
  appId: string; metric: string; series: Point[]; day: string;
  releases: { version: string; date: string }[];
}): Anomaly | null {
  const z = zScore(input.series, input.day);
  if (!z || Math.abs(z.z) < 2.5) return null;
  const value = input.series.find((p) => p.day === input.day)!.value;
  const direction = z.z < 0 ? "drop" : "spike";
  const nearRelease = input.releases.find(
    (r) => Math.abs(daysBetween(r.date, input.day)) <= 2,
  );
  const cause = nearRelease
    ? `Near the ${nearRelease.version} release (${nearRelease.date})`
    : direction === "drop"
      ? "No release nearby — check storefront availability / external event"
      : "Unusual positive movement — check press/feature/ASA";
  return { appId: input.appId, metric: input.metric, day: input.day, direction, z: z.z, value, baseline: z.baseline, cause, nearRelease: nearRelease !== undefined };
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86400000;
}
