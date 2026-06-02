import { Card } from "@/components/glass/Card";
import type { ActionItem, Severity } from "@/lib/intelligence/actions";

const COLOR: Record<Severity, string> = {
  critical: "var(--bad)",
  opportunity: "var(--accent)",
  good: "var(--ok)",
};
const LABEL: Record<Severity, string> = {
  critical: "Needs attention",
  opportunity: "Opportunity",
  good: "Good news",
};

export function ActionCard({ item, variant = "full" }: { item: ActionItem; variant?: "full" | "compact" }) {
  const color = COLOR[item.severity];

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2 py-1.5 text-sm">
        <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="sr-only">{LABEL[item.severity]}: </span>
        <span className="truncate font-medium">{item.appName}</span>
        <span className="truncate text-[var(--ink-2)]"> · {item.title}</span>
      </div>
    );
  }

  return (
    <Card>
      <div className="border-l-2 pl-3" style={{ borderColor: color }}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">{item.appName}</span>
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
            {LABEL[item.severity]}
          </span>
        </div>
        <div className="mt-1 font-medium">{item.title}</div>
        <div className="mt-0.5 text-sm text-[var(--ink-2)]">{item.detail}</div>
        <div className="mt-2 text-sm" style={{ color }}><span aria-hidden>→ </span><span>{item.recommendation}</span></div>
      </div>
    </Card>
  );
}
