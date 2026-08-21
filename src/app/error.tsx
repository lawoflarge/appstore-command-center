"use client";

import { useEffect, useState } from "react";

interface Health {
  ok?: boolean; reason?: string; hint?: string; status?: number;
  repo?: string; tokenExpiresAt?: string | null; detail?: string;
}

// Every page reads the data repo through the GitHub Contents API, so anything wrong with
// GITHUB_DATA_TOKEN throws during the server render — and Next replaces that with a bare
// "Application error: a server-side exception has occurred" plus a digest. That digest is
// useless without log access, and the cause (an expired fine-grained PAT) recurs on a
// schedule. This page asks /api/health what is actually broken and says so.
export default function Error({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [probed, setProbed] = useState(false);

  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((h: Health) => setHealth(h))
      .catch(() => setHealth(null))
      .finally(() => setProbed(true));
  }, []);

  return (
    <main>
      <div className="glass p-5">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">Dashboard couldn&apos;t load</h1>
        <p className="mb-4 text-sm text-[var(--muted,#666)]">
          The page threw while reading the data repo on the server.
        </p>

        {!probed && <p className="text-sm">Checking what&apos;s wrong…</p>}

        {probed && health?.hint && (
          <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="mb-1 text-sm font-semibold">
              {health.ok ? "GitHub data repo is reachable" : "Likely cause"}
            </p>
            <p className="text-sm">{health.hint}</p>
            {health.repo && (
              <p className="mt-2 text-xs text-[var(--muted,#666)]">
                repo {health.repo}
                {typeof health.status === "number" ? ` · GitHub answered ${health.status}` : ""}
                {health.tokenExpiresAt ? ` · token expires ${health.tokenExpiresAt}` : ""}
              </p>
            )}
            {health.ok && (
              <p className="mt-2 text-sm text-[var(--muted,#666)]">
                So the token is fine — check the Vercel runtime logs for this digest.
              </p>
            )}
          </div>
        )}

        {probed && !health && (
          <p className="mb-4 text-sm">
            The health check itself failed — the session may have expired. Try reloading, or
            check the Vercel runtime logs.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium"
          >
            Try again
          </button>
          {error.digest && (
            <span className="text-xs text-[var(--muted,#666)]">digest {error.digest}</span>
          )}
        </div>
      </div>
    </main>
  );
}
