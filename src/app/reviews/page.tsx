import { Nav } from "@/components/glass/Nav";
import { Card } from "@/components/glass/Card";
import { makeStore, ghBackendFromEnv } from "@/lib/store/store";
import { visibleAppIds } from "@/lib/aggregate/api";
import { reviewsPath, type Review } from "@/lib/store/paths";

export const dynamic = "force-dynamic";

export default async function Reviews() {
  const store = makeStore(ghBackendFromEnv());
  const ids = await visibleAppIds(store);
  const all: { appId: string; r: Review }[] = [];
  for (const id of ids) {
    const rs = await store.readJson<Review[]>(reviewsPath(id), []);
    rs.slice(0, 20).forEach((r) => all.push({ appId: id, r }));
  }
  all.sort((a, b) => b.r.createdDate.localeCompare(a.r.createdDate));
  return (
    <main>
      <Nav />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Reviews</h1>
      <div className="grid gap-3">
        {all.map(({ r }) => (
          <Card key={r.id}>
            <div className="flex justify-between text-sm">
              <span className="text-[var(--star)]">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
              <span className="text-[var(--ink-2)]">{r.territory} · {r.createdDate.slice(0, 10)}{r.responded ? " · replied" : ""}</span>
            </div>
            <div className="mt-1 font-semibold">{r.title}</div>
            <div className="text-sm text-[var(--ink-2)]">{r.body}</div>
          </Card>
        ))}
        {all.length === 0 && <Card>No reviews yet.</Card>}
      </div>
    </main>
  );
}
