export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

/**
 * Hand-rolled compact currency formatter. `Intl.NumberFormat`'s `notation:
 * "compact"` renders round numbers differently between Node's ICU (SSR) and
 * a browser's ICU (client) — e.g. 0 → "$0.0" vs "$0", 3_000_000 → "$3.0M" vs
 * "$3M" — which causes React hydration mismatches. Doing it ourselves keeps
 * output identical in both environments.
 */
export function formatCompactCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  if (abs >= 1_000_000) return `${sign}$${trim(Math.round(abs / 100_000) / 10)}M`;
  if (abs >= 1_000) return `${sign}$${trim(Math.round(abs / 100) / 10)}K`;
  return `${sign}$${Math.round(abs)}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

/** "Just now" / "3m ago" / "5h ago" / "2d ago" — deliberately not `Intl.RelativeTimeFormat`, whose unit-rounding
 * has shown the same kind of Node/browser ICU divergence as compact currency did, and this needs to tick client-side anyway. */
export function formatRelativeTime(value: string | Date | null | undefined, now: number = Date.now()): string {
  if (!value) return "never";
  const d = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  SINGLE_FAMILY: "Single-Family",
  MULTI_FAMILY: "Multi-Family",
  CONDO: "Condo",
  TOWNHOUSE: "Townhouse",
};

export const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  PENDING: "Pending",
  SOLD: "Sold",
};
