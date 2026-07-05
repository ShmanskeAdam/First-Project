import type { ListingFilters, ListingQuery, PaginatedListings, FilterPreset, ScoringConfig } from "@/types/listing";
import type { TownInfo } from "@/lib/towns";
import type { TrendPoint } from "@/app/api/analytics/trends/route";
import type { TownComparisonRow } from "@/app/api/analytics/comparison/route";
import type { SyncStatusPayload } from "@/lib/syncStatus";

function toQueryString(filters: ListingFilters & Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(","));
    } else {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export async function fetchListings(query: ListingQuery): Promise<PaginatedListings> {
  const qs = toQueryString(query as ListingQuery & Record<string, unknown>);
  const res = await fetch(`/api/listings?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch listings");
  return res.json();
}

export async function fetchTowns(): Promise<{ towns: TownInfo[]; counties: string[] }> {
  const res = await fetch("/api/towns");
  if (!res.ok) throw new Error("Failed to fetch towns");
  return res.json();
}

export async function fetchDeals(filters: ListingFilters, limit = 50): Promise<PaginatedListings> {
  const qs = toQueryString({ ...filters, limit } as ListingFilters & Record<string, unknown>);
  const res = await fetch(`/api/deals?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch deals");
  return res.json();
}

export async function fetchTrends(towns: string[] | undefined, years: number): Promise<{ series: TrendPoint[] }> {
  const qs = toQueryString({ towns, years } as unknown as ListingFilters & Record<string, unknown>);
  const res = await fetch(`/api/analytics/trends?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch trends");
  return res.json();
}

export async function fetchHistogram(
  filters: ListingFilters
): Promise<{ buckets: { rangeStart: number; rangeEnd: number; count: number }[]; min: number; max: number }> {
  const qs = toQueryString(filters as ListingFilters & Record<string, unknown>);
  const res = await fetch(`/api/analytics/histogram?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch histogram");
  return res.json();
}

export async function fetchComparison(
  towns: string[],
  filters: ListingFilters
): Promise<{ rows: TownComparisonRow[] }> {
  const qs = toQueryString({ ...filters, towns } as ListingFilters & Record<string, unknown>);
  const res = await fetch(`/api/analytics/comparison?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch comparison");
  return res.json();
}

export async function fetchSettings(): Promise<{ config: ScoringConfig; defaults: ScoringConfig }> {
  const res = await fetch("/api/settings");
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export async function updateSettings(patch: Partial<ScoringConfig>): Promise<{ config: ScoringConfig }> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Failed to update settings");
  return res.json();
}

export async function fetchPresets(): Promise<{ presets: FilterPreset[] }> {
  const res = await fetch("/api/filter-presets");
  if (!res.ok) throw new Error("Failed to fetch presets");
  return res.json();
}

export async function createPreset(name: string, filters: ListingFilters): Promise<{ preset: FilterPreset }> {
  const res = await fetch("/api/filter-presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, filters }),
  });
  if (!res.ok) throw new Error("Failed to create preset");
  return res.json();
}

export async function deletePreset(id: string): Promise<void> {
  await fetch(`/api/filter-presets/${id}`, { method: "DELETE" });
}

export async function fetchSyncStatus(): Promise<SyncStatusPayload> {
  const res = await fetch("/api/sync");
  if (!res.ok) throw new Error("Failed to fetch sync status");
  return res.json();
}

export class SyncThrottledError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Refreshed too recently. Try again in ${retryAfterSeconds}s.`);
  }
}

export async function triggerSync(): Promise<SyncStatusPayload> {
  const res = await fetch("/api/sync", { method: "POST" });
  const body = await res.json();
  if (res.status === 429) throw new SyncThrottledError(body.retryAfterSeconds ?? 30);
  if (!res.ok) throw new Error(body.error ?? "Refresh failed");
  return body;
}
