import {
  getActiveProvider,
  getDefaultSyncQuery,
  getFullSyncQuery,
  RentCastListingProvider,
  type RawListing,
} from "@/lib/providers";
import { COUNTIES } from "@/lib/towns";
import { ingestRawListings, clearMockListingsIfLiveSource } from "@/lib/ingest";
import { getSyncStatus, recordSyncStatus } from "@/lib/syncStatus";
import { reserveRentcastRequests, reconcileRentcastUsage, getRentcastUsage } from "@/lib/appConfig";
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
 * 2. **Monthly budget** (all modes): requests are *atomically reserved* before
 *    any API call (see `reserveRentcastRequests`), then reconciled down to the
 *    real count afterward. Because the reservation is a single conditional DB
 *    UPDATE, the month's total can never exceed the budget even under
 *    concurrent syncs — this is the hard "never overrun the free tier"
 *    guarantee, independent of the daily guard's timing.
 */
export async function runSync(mode: "daily" | "full" = "daily"): Promise<SyncRunResult> {
  const provider = await getActiveProvider();
  const isRentcast = provider.key === "rentcast";
  // Worst-case request estimate reserved up front: up to 2 pages per county.
  const estimate = mode === "full" ? COUNTIES.length * 2 : 2;
  let reserved = false;

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

    const { ok, usage } = await reserveRentcastRequests(estimate);
    if (!ok) {
      const status = await getSyncStatus();
      return {
        ...status,
        clearedMockListings: 0,
        skipped: true,
        note: `Monthly RentCast request budget reached (${usage.used}/${usage.budget}). Syncs resume automatically next month.`,
      };
    }
    reserved = true;
  }

  let raws: RawListing[];
  try {
    const query = mode === "full" ? getFullSyncQuery(provider) : getDefaultSyncQuery(provider);
    raws = await provider.fetchListings(query);
  } finally {
    // Settle the reservation against the requests actually made — refunding the
    // usual over-estimate, and also refunding correctly if the fetch threw
    // partway (lastFetchRequestCount reflects real attempts either way).
    if (reserved && provider instanceof RentCastListingProvider) {
      await reconcileRentcastUsage(estimate, provider.lastFetchRequestCount);
    }
  }

  const results = await ingestRawListings(raws, provider.key);
  const clearedMockListings = await clearMockListingsIfLiveSource(provider.key);
  const status = await recordSyncStatus(provider.key, raws.length, results.length);

  let note: string | null = null;
  if (clearedMockListings > 0) {
    note = `Cleared ${clearedMockListings.toLocaleString()} demo listings — now showing real data.`;
  } else if (isRentcast) {
    const usage = await getRentcastUsage();
    note =
      mode === "full"
        ? `Pulled all 7 counties (${raws.length.toLocaleString()} listings). API budget used: ${usage.used}/${usage.budget} this month.`
        : `Pulled ${getTodaysCounty()} County (${raws.length.toLocaleString()} listings).`;
  }

  return { ...status, clearedMockListings, skipped: false, note };
}
