"use client";
import { Area } from "./Area";
import { MultiLine } from "./MultiLine";
import { StackedArea } from "./StackedArea";
import { Bar } from "./Bar";
import { Funnel } from "./Funnel";
import { SmallMultiples } from "./SmallMultiples";
import { Heatmap } from "./Heatmap";
import type { SeriesData } from "@/lib/dashboards/types";

// A series is "empty" when it carries no informative signal — no points/series, or every
// value is zero. Apple's reports lag ~24-48h and several metrics only populate once their
// report type has been collected, so an honest placeholder beats a blank or flat-zero chart.
function hasData(d: SeriesData): boolean {
  switch (d.kind) {
    case "area":
    case "bar":
    case "heatmap":
      return d.points.some((p) => p.value !== 0);
    case "multiLine":
    case "stackedArea":
    case "smallMultiples":
      return d.series.some((s) => s.points.some((p) => p.value !== 0));
    case "funnel":
      return d.stages.some((s) => s.value !== 0);
  }
}

function EmptyState() {
  return (
    <div className="flex h-44 flex-col items-center justify-center gap-1 text-center">
      <div className="text-sm font-medium text-[var(--ink-2)]">No data yet</div>
      <div className="max-w-[26ch] text-xs text-[var(--ink-2)] opacity-70">
        Apple&apos;s reports lag ~24–48h. This fills in after the next daily collection.
      </div>
    </div>
  );
}

export function VizRenderer({ data }: { data: SeriesData }) {
  if (!hasData(data)) return <EmptyState />;
  switch (data.kind) {
    case "area": return <Area data={data} />;
    case "multiLine": return <MultiLine data={data} />;
    case "stackedArea": return <StackedArea data={data} />;
    case "bar": return <Bar data={data} />;
    case "funnel": return <Funnel data={data} />;
    case "smallMultiples": return <SmallMultiples data={data} />;
    case "heatmap": return <Heatmap data={data} />;
  }
}
