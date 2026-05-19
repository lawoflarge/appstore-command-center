import type { RatingPoint } from "@/lib/store/paths";

export async function collectRatings(
  appId: string,
  countries: string[],
  day: string,
): Promise<RatingPoint> {
  const byCountry: RatingPoint["byCountry"] = {};
  for (const c of countries) {
    const url = `https://itunes.apple.com/lookup?id=${appId}&country=${c}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) continue;
    const j = (await res.json()) as {
      results: { averageUserRating?: number; userRatingCount?: number }[];
    };
    const hit = j.results?.[0];
    if (!hit || !hit.userRatingCount) continue;
    byCountry[c] = {
      avg: Number(hit.averageUserRating ?? 0),
      count: Number(hit.userRatingCount ?? 0),
    };
  }
  let count = 0,
    weighted = 0;
  for (const v of Object.values(byCountry)) {
    count += v.count;
    weighted += v.avg * v.count;
  }
  return { day, byCountry, count, avg: count ? weighted / count : 0 };
}
