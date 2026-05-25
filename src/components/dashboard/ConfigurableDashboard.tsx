"use client";
import { useState, useCallback } from "react";
import { ChartCardFrame } from "./ChartCardFrame";
import { CardEditor } from "./CardEditor";
import type { ChartCard, DashboardSlice } from "@/lib/dashboards/types";
import type { RawBundle } from "@/lib/aggregate/series";

function uuid(): string { return crypto.randomUUID(); }

export function ConfigurableDashboard({
  id, initial, raw, apps,
}: {
  id: string;
  initial: DashboardSlice;
  raw: RawBundle;
  apps: { id: string; name: string }[];
}) {
  const [cards, setCards] = useState<ChartCard[]>(initial.cards);
  const [editing, setEditing] = useState<ChartCard | null>(null);

  const persist = useCallback((next: ChartCard[]) => {
    setCards(next);
    void fetch(`/api/dashboards/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cards: next, updatedAt: new Date().toISOString() }),
    });
  }, [id]);

  const onSave = (c: ChartCard) => {
    const exists = cards.find((x) => x.id === c.id);
    const next = exists ? cards.map((x) => x.id === c.id ? c : x) : [...cards, c];
    persist(next);
    setEditing(null);
  };

  const onAdd = () => {
    const isGlance = id === "glance";
    const draft: ChartCard = {
      id: uuid(), title: "New chart", metric: "downloads", viz: "area",
      appIds: isGlance ? "all" : [id.replace(/^app:/, "")],
      range: "30d", bucket: "day", breakdown: "none", compare: "none",
    };
    setEditing(draft);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= cards.length) return;
    const next = [...cards];
    [next[idx], next[j]] = [next[j], next[idx]];
    persist(next);
  };

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Charts</h2>
        <button onClick={onAdd} className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white">
          + Add chart
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {cards.map((c, i) => (
          <ChartCardFrame
            key={c.id}
            card={c}
            raw={raw}
            onEdit={() => setEditing(c)}
            onDelete={() => persist(cards.filter((x) => x.id !== c.id))}
            onMoveUp={() => move(i, -1)}
            onMoveDown={() => move(i, +1)}
          />
        ))}
      </div>
      {editing && (
        <CardEditor
          card={editing}
          raw={raw}
          apps={apps}
          dashboardId={id}
          onSave={onSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </section>
  );
}
