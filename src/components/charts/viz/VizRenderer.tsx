"use client";
import { Area } from "./Area";
import { MultiLine } from "./MultiLine";
import { StackedArea } from "./StackedArea";
import { Bar } from "./Bar";
import { Funnel } from "./Funnel";
import { SmallMultiples } from "./SmallMultiples";
import { Heatmap } from "./Heatmap";
import type { SeriesData } from "@/lib/dashboards/types";

export function VizRenderer({ data }: { data: SeriesData }) {
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
