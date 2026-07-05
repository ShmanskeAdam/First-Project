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
 */
export class CompIndex {
  private activeCohorts = new Map<string, CohortStats>();
  private soldCohorts = new Map<string, SoldCohortStats>();
  private townDom = new Map<string, number>();
  private globalActive: CohortStats;
  private globalSold: SoldCohortStats;

  constructor(listings: ScoringInput[], private lookbackMonths: number) {
    this.globalActive = aggregateActive(listings);
    this.globalSold = aggregateSold(listings, lookbackMonths);

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

    const byType = groupBy(listings, (l) => l.propertyType);
    for (const [type, group] of byType) {
      this.activeCohorts.set(type, aggregateActive(group));
      this.soldCohorts.set(type, aggregateSold(group, lookbackMonths));
    }
  }

  /** Falls back from the tightest cohort (town+type+bed bucket) to looser ones when a cohort has too few comps. */
  activeCohortFor(l: ScoringInput): CohortStats {
    const tight = this.activeCohorts.get(`${l.town}|${l.propertyType}|${bedBucket(l.beds)}`);
    if (tight && tight.count >= 3) return tight;
    const medium = this.activeCohorts.get(`${l.town}|${l.propertyType}`);
    if (medium && medium.count >= 3) return medium;
    const loose = this.activeCohorts.get(l.propertyType);
    if (loose && loose.count >= 3) return loose;
    return this.globalActive;
  }

  soldCohortFor(l: ScoringInput): SoldCohortStats {
    const tight = this.soldCohorts.get(`${l.town}|${l.propertyType}|${bedBucket(l.beds)}`);
    if (tight && tight.count >= 2) return tight;
    const medium = this.soldCohorts.get(`${l.town}|${l.propertyType}`);
    if (medium && medium.count >= 2) return medium;
    const loose = this.soldCohorts.get(l.propertyType);
    if (loose && loose.count >= 2) return loose;
    return this.globalSold;
  }

  townMedianDom(town: string): number {
    return this.townDom.get(town) ?? median(Array.from(this.townDom.values())) ?? 30;
  }
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

/** Maps a "% below comp average" value to a 0-1 component, clamped at +/-30%. Neutral (0.5) at 0%. */
function pctBelowToComponent(pctBelow: number): number {
  return clip((clip(pctBelow, -0.3, 0.3) + 0.3) / 0.6, 0, 1);
}

/**
 * Scores one listing against its precomputed comp cohorts. Returns a 0-100
 * score plus a human-readable breakdown of which signals drove it — both the
 * Top Deals leaderboard and the inline table badge use this same result.
 */
export function scoreListing(listing: ScoringInput, index: CompIndex, config: ScoringConfig): DealScoreResult {
  const reasons: DealScoreReason[] = [];

  // 1. Price/sqft vs. comparable active listings (town + type + bed cohort, falling back to looser cohorts).
  const cohort = index.activeCohortFor(listing);
  const pctBelowAvgPpsf = cohort.avgPricePerSqft > 0 ? (cohort.avgPricePerSqft - listing.pricePerSqft) / cohort.avgPricePerSqft : 0;
  const ppsfComponent = pctBelowToComponent(pctBelowAvgPpsf);
  if (Math.abs(pctBelowAvgPpsf) >= 0.08) {
    reasons.push({
      label: pctBelowAvgPpsf > 0 ? "Priced below comps" : "Priced above comps",
      detail: `${Math.abs(Math.round(pctBelowAvgPpsf * 100))}% ${pctBelowAvgPpsf > 0 ? "below" : "above"} average $/sqft for comparable ${listing.propertyType.toLowerCase().replace("_", "-")} homes in ${listing.town}`,
      points: Math.round(config.pricePerSqftWeight * (ppsfComponent - 0.5) * 200),
    });
  }

  // 2. Price-cut magnitude + recency.
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

  // 3. Days on market vs. town median, combined with price positioning. Freshness alone
  // (domRatio <= 1) is not a deal signal either way and stays neutral — only *staleness*
  // moves the needle, and only in the direction price positioning suggests: stale +
  // underpriced reads as a possible motivated seller (reward), stale + overpriced reads
  // as a possible underlying issue (penalize). This deliberately avoids "old = bad deal".
  const townMedianDom = index.townMedianDom(listing.town);
  const domRatio = listing.daysOnMarket / Math.max(townMedianDom, 1);
  const pricedWell = ppsfComponent >= 0.5;
  const staleness = Math.max(0, domRatio - 1);
  const domComponent = clip(0.5 + (pricedWell ? 1 : -1) * staleness * 0.5, 0, 1);
  if (Math.abs(domComponent - 0.5) >= 0.15) {
    reasons.push({
      label: pricedWell ? "Stale + underpriced" : "Stale + overpriced",
      detail: `${listing.daysOnMarket} days on market vs. town median of ${Math.round(townMedianDom)}${
        pricedWell ? " — could indicate a motivated seller" : " — may indicate an underlying issue"
      }`,
      points: Math.round(config.domWeight * (domComponent - 0.5) * 200),
    });
  }

  // 4. Price relative to recent comparable sold prices in the same town/type/bed cohort.
  const soldCohort = index.soldCohortFor(listing);
  const pctBelowSoldAvg =
    soldCohort.avgSoldPricePerSqft > 0 ? (soldCohort.avgSoldPricePerSqft - listing.pricePerSqft) / soldCohort.avgSoldPricePerSqft : 0;
  const compSalesComponent = soldCohort.count > 0 ? pctBelowToComponent(pctBelowSoldAvg) : 0.5;
  if (soldCohort.count > 0 && Math.abs(pctBelowSoldAvg) >= 0.08) {
    reasons.push({
      label: pctBelowSoldAvg > 0 ? "Below recent comp sales" : "Above recent comp sales",
      detail: `${Math.abs(Math.round(pctBelowSoldAvg * 100))}% ${pctBelowSoldAvg > 0 ? "below" : "above"} the average $/sqft of ${soldCohort.count} comparable sale${soldCohort.count === 1 ? "" : "s"} in the last ${config.compSaleLookbackMonths} months`,
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

export function scoreListings(listings: ScoringInput[], config: ScoringConfig): Map<string, DealScoreResult> {
  const index = buildCompIndex(listings, config.compSaleLookbackMonths);
  const results = new Map<string, DealScoreResult>();
  for (const listing of listings) {
    results.set(listing.id, scoreListing(listing, index, config));
  }
  return results;
}
