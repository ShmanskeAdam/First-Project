// Categorical palette for multi-town chart series — colorblind-friendly, distinct in both themes.
export const CHART_COLORS = [
  "#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed",
  "#0891b2", "#db2777", "#65a30d", "#4338ca", "#ea580c",
];

export function colorForIndex(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length];
}
