"use client";

import { useEffect, useState } from "react";
import { TownMultiSelect } from "@/components/TownMultiSelect";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { PriceHistogramChart } from "@/components/charts/PriceHistogramChart";
import { TownComparisonChart } from "@/components/charts/TownComparisonChart";
import { fetchTowns, fetchTrends, fetchHistogram, fetchComparison } from "@/lib/apiClient";
import { formatCompactCurrency } from "@/lib/format";
import type { TrendPoint } from "@/app/api/analytics/trends/route";
import type { TownComparisonRow } from "@/app/api/analytics/comparison/route";
import type { TownInfo } from "@/lib/towns";
import type { PropertyType } from "@/types/listing";

const YEAR_OPTIONS = [1, 3, 5];
const PROPERTY_TYPES: { value: PropertyType | ""; label: string }[] = [
  { value: "", label: "All types" },
  { value: "SINGLE_FAMILY", label: "Single-Family" },
  { value: "MULTI_FAMILY", label: "Multi-Family" },
  { value: "CONDO", label: "Condo" },
  { value: "TOWNHOUSE", label: "Townhouse" },
];

export default function AnalyticsPage() {
  const [towns, setTowns] = useState<TownInfo[]>([]);
  const [selectedTowns, setSelectedTowns] = useState<string[]>([]);
  const [years, setYears] = useState(3);
  const [propertyType, setPropertyType] = useState<PropertyType | "">("");

  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [histogram, setHistogram] = useState<{ rangeStart: number; rangeEnd: number; count: number }[]>([]);
  const [comparison, setComparison] = useState<TownComparisonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTowns()
      .then((r) => setTowns(r.towns))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const filters = propertyType ? { propertyTypes: [propertyType], towns: selectedTowns } : { towns: selectedTowns };

    Promise.all([
      fetchTrends(selectedTowns.length ? selectedTowns : undefined, years),
      fetchHistogram(filters),
      selectedTowns.length ? fetchComparison(selectedTowns, propertyType ? { propertyTypes: [propertyType] } : {}) : Promise.resolve({ rows: [] }),
    ])
      .then(([trendsRes, histRes, compRes]) => {
        setTrends(trendsRes.series);
        setHistogram(histRes.buckets);
        setComparison(compRes.rows);
      })
      .catch(() => setError("Failed to load analytics data."))
      .finally(() => setLoading(false));
  }, [selectedTowns, years, propertyType]);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Market Analytics</h1>

      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timeframe</span>
            {YEAR_OPTIONS.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setYears(y)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  years === y ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600"
                }`}
              >
                {y}Y
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Property type</span>
            <select
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value as PropertyType | "")}
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              {PROPERTY_TYPES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Towns (leave empty for all North NJ aggregate)
        </p>
        <TownMultiSelect towns={towns} selected={selectedTowns} onChange={setSelectedTowns} max={8} />
      </div>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className={`grid grid-cols-1 gap-4 lg:grid-cols-2 ${loading ? "opacity-50" : ""}`}>
        <TrendLineChart title="Median price over time" series={trends} valueKey="medianPrice" valueFormatter={formatCompactCurrency} />
        <TrendLineChart
          title="Price per sqft trends"
          series={trends}
          valueKey="avgPricePerSqft"
          valueFormatter={(n) => `$${Math.round(n)}`}
        />
        <TrendLineChart title="Active inventory levels" series={trends} valueKey="activeCount" valueFormatter={(n) => `${n}`} />
        <TrendLineChart title="Days-on-market trend" series={trends} valueKey="medianDom" valueFormatter={(n) => `${n}d`} />
        <PriceHistogramChart buckets={histogram} />
        <TownComparisonChart rows={comparison} />
      </div>
    </div>
  );
}
