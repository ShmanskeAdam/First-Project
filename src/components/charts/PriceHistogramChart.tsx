"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactCurrency } from "@/lib/format";

interface HistogramBucket {
  rangeStart: number;
  rangeEnd: number;
  count: number;
}

export function PriceHistogramChart({ buckets }: { buckets: HistogramBucket[] }) {
  const data = buckets.map((b) => ({
    label: `${formatCompactCurrency(b.rangeStart)}–${formatCompactCurrency(b.rangeEnd)}`,
    count: b.count,
  }));

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">Price distribution (filtered results)</h3>
      {data.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">No listings match the current filters.</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 11 }} width={32} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#2563eb" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
