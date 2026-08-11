import {
  getActiveProvider,
  getDefaultSyncQuery,
  getFullSyncQuery,
  RentCastListingProvider,
} from "@/lib/providers";
import { ingestRawListings, clearMockListingsIfLiveSource, purgeListingsForSource } from "@/lib/ingest";
import { getSyncStatus, recordSyncStatus } from "@/lib/syncStatus";
import {
  reserveRentcastRequest,
  getRentcastUsage,
  claimCatchUpFullSync,
  resetCatchUpClaim,
  markFullSyncCompleted,
  hasStaleCoverageData,
} from "@/lib/appConfig";
import { getTodaysCounty } from "@/lib/syncRotation";
import { COUNTIES } from "@/lib/towns";
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
  let effectiveMode: "daily" | "full" = mode;
  let claimedCatchUp = false;
  let staleCoverage = false;

  if (isRentcast) {
    // Catch-up escalation: if no comprehensive (all-county, fully-paginated)
    // pull has ever completed — first connect, or a deployment upgraded from
    // code that capped pagination — the next daily trigger claims the job
    // atomically and runs a FULL pull instead, bypassing the daily guard.
    // Exactly one caller can claim it, so simultaneous Refresh clicks can't
    // both launch full pulls; the site self-heals with zero manual steps.
    if (mode === "daily") {
      // Note whether anything was already stored under a *different* coverage
      // signature: those rows were gathered under superseded rules (e.g. the
      // broken county-param query that returned a mis-attributed statewide
      // slice) and must be discarded rather than merged with correct data.
      staleCoverage = await hasStaleCoverageData();
      claimedCatchUp = await claimCatchUpFullSync();
      if (claimedCatchUp) effectiveMode = "full";
    }

    if (effectiveMode === "daily") {
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
      // Give the catch-up back so it runs when budget returns (next month).
      if (claimedCatchUp) await resetCatchUpClaim();
      const status = await getSyncStatus();
      return {
        ...status,
        clearedMockListings: 0,
        skipped: true,
        note: `Monthly RentCast request budget reached (${usage.used}/${usage.budget}). Syncs resume automatically next month.`,
      };
    }
  }

  let raws;
  try {
    const baseQuery = effectiveMode === "full" ? getFullSyncQuery(provider) : getDefaultSyncQuery(provider);
    // Attach the atomic budget gate for RentCast; other providers ignore it.
    const query = isRentcast ? { ...baseQuery, requestGate: reserveRentcastRequest } : baseQuery;
    raws = await provider.fetchListings(query);
  } catch (err) {
    // A failed catch-up must not count as done — release the claim to retry later.
    if (claimedCatchUp) await resetCatchUpClaim();
    throw err;
  }

  const gateDenied = provider instanceof RentCastListingProvider && provider.lastFetchGateDenied;
  if (isRentcast && effectiveMode === "full" && !claimedCatchUp) {
    // Explicit full runs (connect flow, sync:full) also count as the comprehensive pull.
    await markFullSyncCompleted();
  }
  // Note: a budget-truncated full pull still counts as claimed/completed — the
  // daily rotation now paginates fully, so any shortfall converges to complete
  // coverage over the following week without re-burning a full pull each day.

  // A coverage-changing catch-up replaces the dataset rather than merging into
  // it: rows from the superseded strategy that this pull doesn't return would
  // otherwise linger forever with wrong county attribution. Delete only after
  // the fetch succeeds, so a failed pull never leaves the site empty.
  let purgedStaleListings = 0;
  if (claimedCatchUp && staleCoverage && raws.length > 0) {
    purgedStaleListings = await purgeListingsForSource(provider.key);
  }

  const results = await ingestRawListings(raws, provider.key);
  const clearedMockListings = await clearMockListingsIfLiveSource(provider.key);
  const status = await recordSyncStatus(provider.key, raws.length, results.length);

  let note: string | null = null;
  if (isRentcast) {
    const usage = await getRentcastUsage();
    const cleared = clearedMockListings > 0 ? ` Cleared ${clearedMockListings.toLocaleString()} demo listings.` : "";
    const replaced = purgedStaleListings > 0 ? ` Replaced ${purgedStaleListings.toLocaleString()} stale listings.` : "";
    const partial = gateDenied
      ? " Monthly API budget hit mid-pull — the remaining areas fill in automatically on upcoming syncs."
      : usage.used >= usage.budget
        ? " Monthly API budget now reached; more will sync next month."
        : "";
    // Per-county counts make coverage auditable at a glance ("is Essex really
    // in there?") instead of hiding behind a single total.
    const counts =
      provider instanceof RentCastListingProvider
        ? Object.entries(provider.lastFetchCountyCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([c, n]) => `${c} ${n.toLocaleString()}`)
            .join(", ")
        : "";
    const breakdown = counts ? ` By county: ${counts}.` : "";
    note =
      effectiveMode === "full"
        ? `Pulled ${raws.length.toLocaleString()} live listings across all ${COUNTIES.length} North NJ counties (every town, no cap).${breakdown}${cleared}${replaced} API budget used: ${usage.used}/${usage.budget} this month.${partial}`
        : `Pulled ${getTodaysCounty()} County (${raws.length.toLocaleString()} listings).${cleared}${replaced}${partial}`;
  } else if (clearedMockListings > 0) {
    note = `Cleared ${clearedMockListings.toLocaleString()} demo listings — now showing real data.`;
  }

  return { ...status, clearedMockListings, skipped: false, note };
}
