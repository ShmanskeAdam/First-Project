"use client";

import type { MarketSummary } from "@/lib/apiClient";
import { formatCompactCurrency, formatNumber } from "@/lib/format";

function Delta({ pct, invert = false }: { pct: number | null; invert?: boolean }) {
  if (pct === null || !Number.isFinite(pct)) return <span className="text-xs text-slate-400">— vs last month</span>;
  const up = pct > 0.0005;
  const down = pct < -0.0005;
  const good = invert ? down : up;
  const cls = !up && !down ? "text-slate-400" : good ? "text-emerald-600" : "text-rose-600";
  const arrow = up ? "▲" : down ? "▼" : "•";
  return (
    <span className={`text-xs font-medium ${cls}`}>
      {arrow} {Math.abs(pct * 100).toFixed(1)}% vs last month
    </span>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-0.5">{sub}</p>
    </div>
  );
}

export function MarketSummaryCards({ summary }: { summary: MarketSummary }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Card
        label="Median price"
        value={formatCompactCurrency(summary.medianPrice)}
        sub={<Delta pct={summary.momMedianPricePct} />}
      />
      <Card
        label="Median $/sqft"
        value={`$${formatNumber(summary.medianPricePerSqft)}`}
        sub={<span className="text-xs text-slate-400">active listings</span>}
      />
      <Card
        label="Active listings"
        value={formatNumber(summary.activeCount)}
        sub={<Delta pct={summary.momInventoryPct} />}
      />
      <Card
        label="Median DOM"
        value={`${summary.medianDom}d`}
        sub={
          summary.momDomDelta === null ? (
            <span className="text-xs text-slate-400">— vs last month</span>
          ) : (
            <span
              className={`text-xs font-medium ${
                summary.momDomDelta > 0 ? "text-rose-600" : summary.momDomDelta < 0 ? "text-emerald-600" : "text-slate-400"
              }`}
            >
              {summary.momDomDelta > 0 ? "▲" : summary.momDomDelta < 0 ? "▼" : "•"} {Math.abs(summary.momDomDelta)}d vs last
              month
            </span>
          )
        }
      />
      <Card
        label="With price cut"
        value={`${Math.round(summary.priceCutShare * 100)}%`}
        sub={<span className="text-xs text-slate-400">of active listings</span>}
      />
    </div>
  );
}
