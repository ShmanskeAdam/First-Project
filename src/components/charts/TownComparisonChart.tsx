"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TownComparisonRow } from "@/app/api/analytics/comparison/route";
import { formatCompactCurrency } from "@/lib/format";

function MiniBarChart({
  title,
  rows,
  dataKey,
  formatter,
  color,
}: {
  title: string;
  rows: TownComparisonRow[];
  dataKey: keyof TownComparisonRow;
  formatter: (n: number) => string;
  color: string;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 32)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatter} />
          <YAxis type="category" dataKey="town" tick={{ fontSize: 11 }} width={100} />
          <Tooltip formatter={(v: number) => formatter(v)} />
          <Bar dataKey={dataKey} fill={color} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TownComparisonChart({ rows }: { rows: TownComparisonRow[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-4 text-sm font-semibold text-slate-800">Town-by-town comparison</h3>
      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">Select towns above to compare.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <MiniBarChart title="Avg list price" rows={rows} dataKey="avgPrice" formatter={formatCompactCurrency} color="#2563eb" />
          <MiniBarChart
            title="Avg $/sqft"
            rows={rows}
            dataKey="avgPricePerSqft"
            formatter={(n) => `$${Math.round(n)}`}
            color="#059669"
          />
          <MiniBarChart title="Avg days on market" rows={rows} dataKey="avgDom" formatter={(n) => `${Math.round(n)}d`} color="#d97706" />
        </div>
      )}
    </div>
  );
}
