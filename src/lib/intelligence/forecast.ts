import type { Point } from "./baseline";

export interface Forecast { soFar: number; projected: number; band: { low: number; high: number }; }

const daysInMonthUtc = (day: string) =>
  new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate();

export function forecastMonth(series: Point[], asOf: string): Forecast {
  const month = asOf.slice(0, 7);
  const inMonth = series.filter((p) => p.day.startsWith(month));
  const soFar = inMonth.reduce((s, p) => s + p.value, 0);
  const dayNum = Number(asOf.slice(8, 10));
  const totalDays = daysInMonthUtc(asOf);
  const perDay = dayNum > 0 ? soFar / dayNum : 0;
  const projected = perDay * totalDays;
  const values = inMonth.map((p) => p.value);
  const mean = values.reduce((s, v) => s + v, 0) / (values.length || 1);
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length || 1));
  const remaining = totalDays - dayNum;
  const margin = 1.96 * std * Math.sqrt(remaining);
  return { soFar, projected, band: { low: Math.max(soFar, projected - margin), high: projected + margin } };
}
