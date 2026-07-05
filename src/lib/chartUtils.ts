import type { TrendPoint } from "@/app/api/analytics/trends/route";

export interface PivotedSeries {
  rows: Array<Record<string, number | string>>;
  towns: string[];
}

/** Pivots [{month, town, [valueKey]: n}] into recharts-friendly rows: [{month, TownA: n, TownB: n}]. */
export function pivotTrend(series: TrendPoint[], valueKey: keyof TrendPoint): PivotedSeries {
  const townsSet = new Set<string>();
  const byMonth = new Map<string, Record<string, number | string>>();

  for (const point of series) {
    townsSet.add(point.town);
    const row = byMonth.get(point.month) ?? { month: point.month };
    row[point.town] = point[valueKey] as number;
    byMonth.set(point.month, row);
  }

  const rows = Array.from(byMonth.values()).sort((a, b) => String(a.month).localeCompare(String(b.month)));
  return { rows, towns: Array.from(townsSet).sort() };
}
