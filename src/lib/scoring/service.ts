import { prisma } from "@/lib/db";
import { getScoringConfig } from "./config";
import { buildCompIndex, scoreListingBothScopes, type ScoringInput, type DualDealScore } from "./dealScore";

const UNIVERSE_SELECT = {
  id: true,
  town: true,
  propertyType: true,
  status: true,
  beds: true,
  pricePerSqft: true,
  listPrice: true,
  sqft: true,
  daysOnMarket: true,
  soldPrice: true,
  soldDate: true,
  priceChanges: { select: { oldPrice: true, newPrice: true, changedAt: true } },
} as const;

/**
 * Scores a set of target listings against comp cohorts built from the *entire*
 * market (not just the current filter/page) — comps should reflect the real
 * town/type/bed market, not whatever subset the user happens to be looking at.
 * Returns both the town-comps and NJ-wide scores for each listing.
 */
export async function scoreListingsById(targetIds: string[]): Promise<Map<string, DualDealScore>> {
  const [config, universe] = await Promise.all([
    getScoringConfig(),
    prisma.listing.findMany({ select: UNIVERSE_SELECT }),
  ]);

  const scoringUniverse = universe as unknown as ScoringInput[];
  const index = buildCompIndex(scoringUniverse, config.compSaleLookbackMonths);

  const targetSet = new Set(targetIds);
  const results = new Map<string, DualDealScore>();
  for (const listing of scoringUniverse) {
    if (targetSet.has(listing.id)) {
      results.set(listing.id, scoreListingBothScopes(listing, index, config));
    }
  }
  return results;
}

/** Scores every active listing in the market — used by the Top Deals leaderboard. */
export async function scoreAllActiveListings(): Promise<{ ids: string[]; scores: Map<string, DualDealScore> }> {
  const [config, universe] = await Promise.all([
    getScoringConfig(),
    prisma.listing.findMany({ select: UNIVERSE_SELECT }),
  ]);

  const scoringUniverse = universe as unknown as ScoringInput[];
  const index = buildCompIndex(scoringUniverse, config.compSaleLookbackMonths);

  const activeIds: string[] = [];
  const scores = new Map<string, DualDealScore>();
  for (const listing of scoringUniverse) {
    if (listing.status !== "ACTIVE") continue;
    activeIds.push(listing.id);
    scores.set(listing.id, scoreListingBothScopes(listing, index, config));
  }
  return { ids: activeIds, scores };
}
