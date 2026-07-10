import type { DealScoreReason, DealScoreResult, ListingStatus, PropertyType, ScoringConfig } from "@/types/listing";
import { average, median, clip } from "@/lib/stats";

/** Minimal shape the scorer needs — a subset of the Prisma `Listing` (+ `priceChanges`) fields. */
export interface ScoringInput {
  id: string;
  town: string;
  propertyType: PropertyType;
  status: ListingStatus;
  beds: number;
  pricePerSqft: number;
  listPrice: number;
  sqft: number;
  daysOnMarket: number;
  soldPrice: number | null;
  soldDate: string | Date | null;
  priceChanges: Array<{ oldPrice: number; newPrice: number; changedAt: string | Date }>;
}

/** Which comp universe to score a listing against. */
export type ScoreScope = "town" | "nj";

interface CohortStats {
  avgPricePerSqft: number;
  medianDaysOnMarket: number;
  count: number;
}

interface SoldCohortStats {
  avgSoldPricePerSqft: number;
  count: number;
}

/**
 * Precomputed comparison cohorts so every listing can be scored in O(1)
 * instead of re-querying the whole dataset per row. Built once per request
 * from the full (unfiltered) listing universe via `buildCompIndex`.
 *
 * Two independent scopes are supported: "town" (comps drawn from the
 * listing's own town, falling back to looser town-agnostic cohorts only when
 * the town-level cohort is too small) and "nj" (comps drawn from the entire
 * North NJ market regardless of town, so a listing is scored purely against
 * "similar homes anywhere in North Jersey"). Both scopes share the same
 * type+bed and type-only cohorts as their outermost fallback tiers, since
 * those are already town-agnostic.
 */
export class CompIndex {
  private activeCohorts = new Map<string, CohortStats>();
  private soldCohorts = new Map<string, SoldCohortStats>();
  private townDom = new Map<string, number>();
  private njMedianDom: number;
  private globalActive: CohortStats;
  private globalSold: SoldCohortStats;

  constructor(listings: ScoringInput[], private lookbackMonths: number) {
    this.globalActive = aggregateActive(listings);
    this.globalSold = aggregateSold(listings, lookbackMonths);
    this.njMedianDom = median(nonSold(listings).map((l) => l.daysOnMarket));

    const byTown = groupBy(listings, (l) => l.town);
    for (const [town, group] of byTown) {
      this.townDom.set(town, median(nonSold(group).map((l) => l.daysOnMarket)));
    }

    const byTownType = groupBy(listings, (l) => `${l.town}|${l.propertyType}`);
    for (const [key, group] of byTownType) {
      this.activeCohorts.set(key, aggregateActive(group));
      this.soldCohorts.set(key, aggregateSold(group, lookbackMonths));
    }

    const byTownTypeBeds = groupBy(listings, (l) => `${l.town}|${l.propertyType}|${bedBucket(l.beds)}`);
    for (const [key, group] of byTownTypeBeds) {
      this.activeCohorts.set(key, aggregateActive(group));
      this.soldCohorts.set(key, aggregateSold(group, lookbackMonths));
    }

    // NJ-wide (town-agnostic) tiers — the "nj" scope's tight cohort, and a
    // shared outermost fallback for both scopes.
    const byType = groupBy(listings, (l) => l.propertyType);
    for (const [type, group] of byType) {
      this.activeCohorts.set(njKey(type), aggregateActive(group));
      this.soldCohorts.set(njKey(type), aggregateSold(group, lookbackMonths));
    }

    const byTypeBeds = groupBy(listings, (l) => `${l.propertyType}|${bedBucket(l.beds)}`);
    for (const [key, group] of byTypeBeds) {
      this.activeCohorts.set(njKey(key), aggregateActive(group));
      this.soldCohorts.set(njKey(key), aggregateSold(group, lookbackMonths));
    }
  }

  /**
   * "town" scope falls back tightest-to-loosest: town+type+beds -> town+type
   * -> NJ-wide type+beds -> NJ-wide type -> global. "nj" scope skips the
   * town-specific tiers entirely: NJ-wide type+beds -> NJ-wide type -> global.
   */
  activeCohortFor(l: ScoringInput, scope: ScoreScope): CohortStats {
    if (scope === "town") {
      const tight = this.activeCohorts.get(`${l.town}|${l.propertyType}|${bedBucket(l.beds)}`);
      if (tight && tight.count >= 3) return tight;
      const medium = this.activeCohorts.get(`${l.town}|${l.propertyType}`);
      if (medium && medium.count >= 3) return medium;
    }
    const njTight = this.activeCohorts.get(njKey(`${l.propertyType}|${bedBucket(l.beds)}`));
    if (njTight && njTight.count >= 3) return njTight;
    const njLoose = this.activeCohorts.get(njKey(l.propertyType));
    if (njLoose && njLoose.count >= 3) return njLoose;
    return this.globalActive;
  }

  soldCohortFor(l: ScoringInput, scope: ScoreScope): SoldCohortStats {
    if (scope === "town") {
      const tight = this.soldCohorts.get(`${l.town}|${l.propertyType}|${bedBucket(l.beds)}`);
      if (tight && tight.count >= 2) return tight;
      const medium = this.soldCohorts.get(`${l.town}|${l.propertyType}`);
      if (medium && medium.count >= 2) return medium;
    }
    const njTight = this.soldCohorts.get(njKey(`${l.propertyType}|${bedBucket(l.beds)}`));
    if (njTight && njTight.count >= 2) return njTight;
    const njLoose = this.soldCohorts.get(njKey(l.propertyType));
    if (njLoose && njLoose.count >= 2) return njLoose;
    return this.globalSold;
  }

  medianDomFor(town: string, scope: ScoreScope): number {
    if (scope === "nj") return this.njMedianDom || 30;
    return this.townDom.get(town) ?? this.njMedianDom ?? 30;
  }
}

/** Prefixed so a property type like "CONDO" can't collide with a town literally named "CONDO". */
function njKey(suffix: string): string {
  return `NJ|${suffix}`;
}

export function buildCompIndex(listings: ScoringInput[], lookbackMonths: number): CompIndex {
  return new CompIndex(listings, lookbackMonths);
}

function nonSold(listings: ScoringInput[]) {
  return listings.filter((l) => l.status !== "SOLD");
}

function aggregateActive(listings: ScoringInput[]): CohortStats {
  const active = nonSold(listings);
  return {
    avgPricePerSqft: average(active.map((l) => l.pricePerSqft)),
    medianDaysOnMarket: median(active.map((l) => l.daysOnMarket)),
    count: active.length,
  };
}

function aggregateSold(listings: ScoringInput[], lookbackMonths: number): SoldCohortStats {
  const cutoff = Date.now() - lookbackMonths * 30 * 86_400_000;
  const sold = listings.filter(
    (l) => l.status === "SOLD" && l.soldPrice && l.soldDate && new Date(l.soldDate).getTime() >= cutoff
  );
  const ppsf = sold.map((l) => (l.sqft > 0 ? (l.soldPrice as number) / l.sqft : null)).filter((v): v is number => v !== null);
  return { avgSoldPricePerSqft: average(ppsf), count: ppsf.length };
}

function bedBucket(beds: number): string {
  const b = Math.round(beds);
  return b >= 5 ? "5+" : String(b);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = map.get(key);
    if (arr) arr.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/** Maps a "% better/worse than baseline" value to a 0-1 component, clamped at +/-30%. Neutral (0.5) at 0%. */
function pctBelowToComponent(pctBelow: number): number {
  return clip((clip(pctBelow, -0.3, 0.3) + 0.3) / 0.6, 0, 1);
}

const SCOPE_LABEL: Record<ScoreScope, string> = {
  town: "in {town}",
  nj: "across North NJ",
};

/**
 * Scores one listing against its precomputed comp cohorts for a given scope
 * ("town" = comps from the listing's own town, "nj" = comps from the entire
 * North NJ market). Returns a 0-100 score plus a human-readable breakdown of
 * which signals drove it — both the Top Deals leaderboard and the inline
 * table badges use this same result.
 */
export function scoreListing(listing: ScoringInput, index: CompIndex, config: ScoringConfig, scope: ScoreScope): DealScoreResult {
  const reasons: DealScoreReason[] = [];
  const scopeText = SCOPE_LABEL[scope].replace("{town}", listing.town);

  // A listing with no floor area (land / no house) has a meaningless
  // pricePerSqft of 0, which would otherwise read as "~100% below comps" and
  // score as a fake great deal. Neutralize the two $/sqft-based components for
  // these so land can never surface as a deal (belt-and-suspenders with the
  // $1/sqft floor the Top Deals endpoint enforces on the query side).
  const hasFloorArea = listing.sqft > 0 && listing.pricePerSqft > 0;

  // 1. Price/sqft vs. comparable active listings.
  const cohort = index.activeCohortFor(listing, scope);
  const pctBelowAvgPpsf =
    hasFloorArea && cohort.avgPricePerSqft > 0 ? (cohort.avgPricePerSqft - listing.pricePerSqft) / cohort.avgPricePerSqft : 0;
  const ppsfComponent = pctBelowToComponent(pctBelowAvgPpsf);
  if (hasFloorArea && Math.abs(pctBelowAvgPpsf) >= 0.08) {
    reasons.push({
      label: pctBelowAvgPpsf > 0 ? "Priced below comps" : "Priced above comps",
      detail: `${Math.abs(Math.round(pctBelowAvgPpsf * 100))}% ${pctBelowAvgPpsf > 0 ? "below" : "above"} average $/sqft for comparable ${listing.propertyType.toLowerCase().replace("_", "-")} homes ${scopeText}`,
      points: Math.round(config.pricePerSqftWeight * (ppsfComponent - 0.5) * 200),
    });
  }

  // 2. Price-cut magnitude + recency — scope-independent (based on the listing's own history).
  let priceCutComponent = 0;
  const recentCuts = listing.priceChanges
    .filter((c) => c.newPrice < c.oldPrice)
    .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
  const lastCut = recentCuts[0];
  if (lastCut) {
    const daysSinceCut = (Date.now() - new Date(lastCut.changedAt).getTime()) / 86_400_000;
    const cutPct = (lastCut.oldPrice - lastCut.newPrice) / lastCut.oldPrice;
    const recencyFactor = clip(1 - daysSinceCut / config.priceCutRecencyDays, 0, 1);
    priceCutComponent = clip(cutPct / 0.1, 0, 1) * recencyFactor;
    if (recencyFactor > 0) {
      reasons.push({
        label: "Recent price cut",
        detail: `Price cut $${Math.round(lastCut.oldPrice - lastCut.newPrice).toLocaleString()} (${Math.round(cutPct * 100)}%) ${Math.round(daysSinceCut)} day${Math.round(daysSinceCut) === 1 ? "" : "s"} ago`,
        points: Math.round(config.priceCutWeight * priceCutComponent * 100),
      });
    }
  }

  // 3. Days on market vs. median (town median for "town" scope, NJ-wide median for "nj"
  // scope), combined with price positioning. Freshness alone (domRatio <= 1) is not a deal
  // signal either way and stays neutral — only *staleness* moves the needle, and only in the
  // direction price positioning suggests: stale + underpriced reads as a possible motivated
  // seller (reward), stale + overpriced reads as a possible underlying issue (penalize).
  const medianDom = index.medianDomFor(listing.town, scope);
  const domRatio = listing.daysOnMarket / Math.max(medianDom, 1);
  const pricedWell = ppsfComponent >= 0.5;
  const staleness = Math.max(0, domRatio - 1);
  const domComponent = clip(0.5 + (pricedWell ? 1 : -1) * staleness * 0.5, 0, 1);
  if (Math.abs(domComponent - 0.5) >= 0.15) {
    reasons.push({
      label: pricedWell ? "Stale + underpriced" : "Stale + overpriced",
      detail: `${listing.daysOnMarket} days on market vs. median of ${Math.round(medianDom)} ${scopeText}${
        pricedWell ? " — could indicate a motivated seller" : " — may indicate an underlying issue"
      }`,
      points: Math.round(config.domWeight * (domComponent - 0.5) * 200),
    });
  }

  // 4. Price relative to recent comparable sold prices.
  const soldCohort = index.soldCohortFor(listing, scope);
  const pctBelowSoldAvg =
    hasFloorArea && soldCohort.avgSoldPricePerSqft > 0
      ? (soldCohort.avgSoldPricePerSqft - listing.pricePerSqft) / soldCohort.avgSoldPricePerSqft
      : 0;
  const compSalesComponent = hasFloorArea && soldCohort.count > 0 ? pctBelowToComponent(pctBelowSoldAvg) : 0.5;
  if (hasFloorArea && soldCohort.count > 0 && Math.abs(pctBelowSoldAvg) >= 0.08) {
    reasons.push({
      label: pctBelowSoldAvg > 0 ? "Below recent comp sales" : "Above recent comp sales",
      detail: `${Math.abs(Math.round(pctBelowSoldAvg * 100))}% ${pctBelowSoldAvg > 0 ? "below" : "above"} the average $/sqft of ${soldCohort.count} comparable sale${soldCohort.count === 1 ? "" : "s"} ${scopeText} in the last ${config.compSaleLookbackMonths} months`,
      points: Math.round(config.compSalesWeight * (compSalesComponent - 0.5) * 200),
    });
  }

  const raw =
    config.pricePerSqftWeight * ppsfComponent +
    config.priceCutWeight * priceCutComponent +
    config.domWeight * domComponent +
    config.compSalesWeight * compSalesComponent;

  const score = Math.round(clip(raw, 0, 1) * 100);

  reasons.sort((a, b) => b.points - a.points);

  return { score, reasons };
}

export interface DualDealScore {
  town: DealScoreResult;
  nj: DealScoreResult;
}

/** Computes both the town-comps and NJ-wide scores for one listing in a single pass. */
export function scoreListingBothScopes(listing: ScoringInput, index: CompIndex, config: ScoringConfig): DualDealScore {
  return {
    town: scoreListing(listing, index, config, "town"),
    nj: scoreListing(listing, index, config, "nj"),
  };
}

export function scoreListings(listings: ScoringInput[], config: ScoringConfig): Map<string, DualDealScore> {
  const index = buildCompIndex(listings, config.compSaleLookbackMonths);
  const results = new Map<string, DualDealScore>();
  for (const listing of listings) {
    results.set(listing.id, scoreListingBothScopes(listing, index, config));
  }
  return results;
}
