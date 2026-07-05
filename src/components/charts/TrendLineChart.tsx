"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import type { TrendPoint } from "@/app/api/analytics/trends/route";
import { pivotTrend } from "@/lib/chartUtils";
import { colorForIndex } from "@/lib/chartColors";

interface TrendLineChartProps {
  title: string;
  series: TrendPoint[];
  valueKey: keyof TrendPoint;
  valueFormatter?: (n: number) => string;
}

export function TrendLineChart({ title, series, valueKey, valueFormatter }: TrendLineChartProps) {
  const { rows, towns } = pivotTrend(series, valueKey);
  const fmt = valueFormatter ?? ((n: number) => String(n));

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">{title}</h3>
      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">No data for this selection yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={rows} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} width={64} />
            <Tooltip formatter={(v: number) => fmt(v)} />
            {towns.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {towns.map((town, i) => (
              <Line
                key={town}
                type="monotone"
                dataKey={town}
                stroke={colorForIndex(i)}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
