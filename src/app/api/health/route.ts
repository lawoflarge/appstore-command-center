import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { classifyDataRepoProbe } from "@/lib/health";
import { env } from "@/env";

export const dynamic = "force-dynamic";

// Why the pages fail, in one request. The error page fetches this after a render throws,
// so an expired data token names itself instead of hiding behind Next's opaque digest.
// Edge middleware already gates this path; the session check keeps it closed if the
// matcher ever changes — the response quotes env-var names, so it stays authenticated.
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let e: ReturnType<typeof env>;
  try {
    e = env();
  } catch (err) {
    // A missing/empty env var throws in zod before any GitHub call happens.
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      ok: false, reason: "env-invalid", hint: "Required environment variables are missing or empty.",
      detail: detail.slice(0, 500),
    });
  }

  // HEAD on the repo itself: no content transfer, and it still carries the auth headers
  // (status + token expiry) the classifier reads.
  const res = await fetch(`https://api.github.com/repos/${e.GITHUB_DATA_REPO}`, {
    method: "HEAD",
    headers: {
      Authorization: `Bearer ${e.GITHUB_DATA_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  const probe = classifyDataRepoProbe(res.status, res.headers);
  return NextResponse.json({ ...probe, repo: e.GITHUB_DATA_REPO, branch: e.GITHUB_DATA_BRANCH });
}
