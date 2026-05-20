"use client";

import { useState } from "react";
import type { AppConfig } from "@/lib/store/paths";

export function AppSettingsRow({
  appId, name, initial,
}: { appId: string; name: string; initial: AppConfig }) {
  const [hidden, setHidden] = useState(initial.hidden);
  const [archived, setArchived] = useState(initial.archived);
  const [keywords, setKeywords] = useState<{ term: string; country: string }[]>(initial.keywords);
  const [term, setTerm] = useState("");
  const [country, setCountry] = useState("us");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  function addKeyword() {
    const t = term.trim();
    if (!t) return;
    if (keywords.some((k) => k.term.toLowerCase() === t.toLowerCase() && k.country === country)) return;
    setKeywords([...keywords, { term: t, country }]);
    setTerm("");
  }
  function removeKeyword(i: number) {
    setKeywords(keywords.filter((_, idx) => idx !== i));
  }

  async function save() {
    setStatus("saving");
    setError("");
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId, hidden, archived, keywords }),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status} ${await res.text()}`);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e: unknown) {
      setStatus("error");
      setError(String((e as { message?: string })?.message ?? e));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">{name}</span>
        <span className="text-xs text-[var(--muted,#888)]">{appId}</span>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          Hide from dashboard
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Archive (stop collecting)
        </label>
      </div>

      <div>
        <div className="mb-1 text-sm font-medium">Keyword watchlist (iTunes-Search rank)</div>
        <div className="mb-2 flex flex-wrap gap-2">
          {keywords.length === 0 && (
            <span className="text-xs text-[var(--muted,#888)]">No keywords yet.</span>
          )}
          {keywords.map((k, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-white/60 px-2 py-1 text-xs">
              {k.term}<span className="uppercase opacity-60">·{k.country}</span>
              <button onClick={() => removeKeyword(i)} className="ml-1 opacity-60 hover:opacity-100">✕</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
            placeholder="e.g. currency converter"
            className="flex-1 rounded-lg border border-white/30 bg-white/40 px-3 py-1 text-sm"
          />
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="rounded-lg border border-white/30 bg-white/40 px-2 text-sm"
          >
            {["us", "de", "gb", "nl", "fr", "jp"].map((c) => (
              <option key={c} value={c}>{c.toUpperCase()}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={addKeyword}
            className="rounded-lg bg-white/60 px-3 py-1 text-sm hover:bg-white/80"
          >
            Add
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={status === "saving"}
          className="rounded-lg bg-black/80 px-4 py-1 text-sm text-white hover:bg-black disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        {status === "saved" && <span className="text-xs text-green-700">Saved.</span>}
        {status === "error" && <span className="text-xs text-[var(--bad)]">{error}</span>}
      </div>
    </div>
  );
}
