import {
  getActiveProvider,
  getDefaultSyncQuery,
  getFullSyncQuery,
} from "@/lib/providers";
import { ingestRawListings, clearMockListingsIfLiveSource } from "@/lib/ingest";
import { getSyncStatus, recordSyncStatus } from "@/lib/syncStatus";
import { reserveRentcastRequest, getRentcastUsage } from "@/lib/appConfig";
import { getTodaysCounty } from "@/lib/syncRotation";
import type { SyncStatusPayload } from "@/lib/syncStatus";

export interface SyncRunResult extends SyncStatusPayload {
  clearedMockListings: number;
  /** True when the run intentionally did nothing (already synced today / budget exhausted). */
  skipped: boolean;
  /** Human-readable explanation surfaced next to the Refresh button. */
  note: string | null;
}

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * The one sync implementation, shared by the UI Refresh button, the daily
 * Vercel Cron job, the CLI scripts, and the Settings-page connect flow.
 *
 * For RentCast (the only quota-constrained provider) it enforces two guards
 * that make the whole system safe to expose publicly with zero supervision:
 *
 * 1. **Daily guard** (mode "daily" only): if a RentCast sync already succeeded
 *    today (UTC), the run becomes a no-op with an explanatory note instead of
 *    spending another API request. Any number of Refresh clicks per day costs
 *    at most one county's worth of requests. (Best-effort efficiency layer.)
 * 2. **Monthly budget** (all modes): a per-request gate (`reserveRentcastRequest`)
 *    is attached to the provider query and atomically reserves exactly one
 *    request before each network call. Because each reservation is a single
 *    conditional DB UPDATE, the month's total can never exceed the budget even
 *    under concurrent syncs, and pagination can run unbounded (pulling a whole
 *    county) while still being provably capped. This is the hard "never
 *    overrun the free tier" guarantee, independent of the daily guard.
 */
export async function runSync(mode: "daily" | "full" = "daily"): Promise<SyncRunResult> {
  const provider = await getActiveProvider();
  const isRentcast = provider.key === "rentcast";

  if (isRentcast) {
    if (mode === "daily") {
      const status = await getSyncStatus();
      if (
        status.provider === "rentcast" &&
        status.lastSyncedAt &&
        sameUtcDay(new Date(status.lastSyncedAt), new Date())
      ) {
        return {
          ...status,
          clearedMockListings: 0,
          skipped: true,
          note: `Today's live data is already in (${getTodaysCounty()} County). Next automatic pull: tomorrow.`,
        };
      }
    }

    // Friendly early-out (not the guarantee — the per-request gate is): if the
    // budget is already spent, don't even start.
    const usage = await getRentcastUsage();
    if (usage.used >= usage.budget) {
      const status = await getSyncStatus();
      return {
        ...status,
        clearedMockListings: 0,
        skipped: true,
        note: `Monthly RentCast request budget reached (${usage.used}/${usage.budget}). Syncs resume automatically next month.`,
      };
    }
  }

  const baseQuery = mode === "full" ? getFullSyncQuery(provider) : getDefaultSyncQuery(provider);
  // Attach the atomic budget gate for RentCast; other providers ignore it.
  const query = isRentcast ? { ...baseQuery, requestGate: reserveRentcastRequest } : baseQuery;
  const raws = await provider.fetchListings(query);

  const results = await ingestRawListings(raws, provider.key);
  const clearedMockListings = await clearMockListingsIfLiveSource(provider.key);
  const status = await recordSyncStatus(provider.key, raws.length, results.length);

  let note: string | null = null;
  if (isRentcast) {
    const usage = await getRentcastUsage();
    const cleared = clearedMockListings > 0 ? ` Cleared ${clearedMockListings.toLocaleString()} demo listings.` : "";
    const budgetHit = usage.used >= usage.budget ? " Monthly API budget now reached; more will sync next month." : "";
    note =
      mode === "full"
        ? `Pulled ${raws.length.toLocaleString()} live listings across North NJ.${cleared} API budget used: ${usage.used}/${usage.budget} this month.${budgetHit}`
        : `Pulled ${getTodaysCounty()} County (${raws.length.toLocaleString()} listings).${cleared}${budgetHit}`;
  } else if (clearedMockListings > 0) {
    note = `Cleared ${clearedMockListings.toLocaleString()} demo listings — now showing real data.`;
  }

  return { ...status, clearedMockListings, skipped: false, note };
}
