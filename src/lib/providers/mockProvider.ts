import { TOWNS, getTownInfo } from "@/lib/towns";
import type { PropertyType, ListingStatus } from "@/types/listing";
import type { ListingProvider, ListingProviderQuery, RawListing } from "./types";

/**
 * Deterministic pseudo-random generator (mulberry32) so seeded mock data is
 * reproducible across runs — re-seeding the DB always yields the same towns,
 * prices, and history rather than a new random dataset every time.
 */
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROPERTY_TYPES: PropertyType[] = ["SINGLE_FAMILY", "MULTI_FAMILY", "CONDO", "TOWNHOUSE"];
const STREET_NAMES = [
  "Maple", "Oak", "Elm", "Cedar", "Pine", "Washington", "Franklin", "Highland",
  "Ridge", "Union", "Prospect", "Grove", "Chestnut", "Walnut", "Willow", "Park",
  "Lincoln", "Grant", "Church", "Summit", "Hillside", "Orchard", "Forest", "Meadow",
];
const STREET_SUFFIXES = ["St", "Ave", "Rd", "Dr", "Ln", "Ct", "Ter", "Pl"];

/** Base $/sqft by town, loosely modeled on relative NNJ market tiers. Seed-only. */
function baseTownPricePerSqft(town: string, rand: () => number): number {
  const premiumTowns = new Set([
    "Millburn", "Short Hills", "Summit", "Ridgewood", "Montclair", "Hoboken",
    "Tenafly", "Chatham", "Glen Ridge", "Westfield",
  ]);
  const midTowns = new Set([
    "Jersey City", "Maplewood", "South Orange", "Madison", "Morristown",
    "Cranford", "Glen Rock", "Wyckoff", "Ramsey", "Fort Lee",
  ]);
  let base: number;
  if (premiumTowns.has(town)) base = 420;
  else if (midTowns.has(town)) base = 310;
  else base = 235;
  return base + (rand() - 0.5) * 60;
}

function pick<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}

function randInt(min: number, max: number, rand: () => number): number {
  return Math.floor(min + rand() * (max - min + 1));
}

function makeAddress(rand: () => number): string {
  const num = randInt(1, 999, rand);
  const street = pick(STREET_NAMES, rand);
  const suffix = pick(STREET_SUFFIXES, rand);
  return `${num} ${street} ${suffix}`;
}

export interface MockListingRecord extends RawListing {
  /** Synthetic sync history used only by the seed script to backfill ListingSnapshot rows. */
  history: Array<{ capturedAt: string; listPrice: number; status: ListingStatus; daysOnMarket: number }>;
}

/**
 * Generates a realistic, reproducible set of North NJ listings (active,
 * pending, and sold) complete with price-history events, so the UI, charts,
 * and deal-scoring engine all have something meaningful to work with before
 * any live API key is configured.
 */
export class MockListingProvider implements ListingProvider {
  readonly key = "mock";
  private seed: number;

  constructor(seed = 42) {
    this.seed = seed;
  }

  async fetchListings(query?: ListingProviderQuery): Promise<RawListing[]> {
    return this.generate(query?.towns).map(({ history, ...raw }) => raw);
  }

  /** Seed-script-only entry point that also returns synthetic sync history per listing. */
  generateWithHistory(towns?: string[]): MockListingRecord[] {
    return this.generate(towns);
  }

  private generate(townFilter?: string[]): MockListingRecord[] {
    const rand = mulberry32(this.seed);
    const towns = townFilter?.length ? TOWNS.filter((t) => townFilter.includes(t.name)) : TOWNS;
    const records: MockListingRecord[] = [];
    const now = Date.now();
    const DAY = 86_400_000;

    let counter = 0;
    for (const townInfo of towns) {
      const listingsPerTown = randInt(10, 18, rand);
      const townBasePpsf = baseTownPricePerSqft(townInfo.name, rand);
      const townMedianDom = randInt(18, 55, rand);

      for (let i = 0; i < listingsPerTown; i++) {
        counter++;
        const propertyType = pick(PROPERTY_TYPES, rand);
        const beds = propertyType === "CONDO" ? randInt(1, 3, rand) : randInt(2, 6, rand);
        const baths = Math.max(1, Math.round((beds - randInt(0, 1, rand)) * 2) / 2);
        const sqft =
          propertyType === "CONDO"
            ? randInt(650, 1600, rand)
            : propertyType === "MULTI_FAMILY"
              ? randInt(1800, 4200, rand)
              : randInt(1100, 4500, rand);
        const yearBuilt = randInt(1900, 2023, rand);
        const lotSizeSqft =
          propertyType === "CONDO" ? null : randInt(2500, 22000, rand);

        // Individual listing $/sqft wobbles around the town base — this
        // spread is what lets the deal scorer find genuine under/over-priced
        // outliers relative to town+type+bed comps.
        const ppsfNoise = (rand() - 0.5) * 90;
        const pricePerSqft = Math.max(120, townBasePpsf + ppsfNoise);
        const listPrice = Math.round((pricePerSqft * sqft) / 500) * 500;

        // Status distribution: mostly active, some pending, a good number
        // sold in the past year so comp-sales scoring has data to draw on.
        const statusRoll = rand();
        const status: ListingStatus = statusRoll < 0.55 ? "ACTIVE" : statusRoll < 0.7 ? "PENDING" : "SOLD";

        const daysAgoListed = randInt(1, 260, rand);
        const listedDate = new Date(now - daysAgoListed * DAY);

        let soldDate: Date | null = null;
        let soldPrice: number | null = null;
        let daysOnMarket: number;
        if (status === "SOLD") {
          const domAtSale = randInt(5, Math.max(10, townMedianDom * 2), rand);
          soldDate = new Date(listedDate.getTime() + domAtSale * DAY);
          if (soldDate.getTime() > now) soldDate = new Date(now - randInt(1, 30, rand) * DAY);
          soldPrice = Math.round((listPrice * (0.94 + rand() * 0.1)) / 500) * 500;
          daysOnMarket = domAtSale;
        } else {
          daysOnMarket = Math.min(daysAgoListed, randInt(1, 180, rand));
        }

        // Price-cut history: ~30% of active/pending listings have had one or
        // two reductions, which the deal scorer treats as a strong signal.
        const history: MockListingRecord["history"] = [];
        let runningPrice = listPrice;
        const hasCuts = status !== "SOLD" && rand() < 0.3;
        const cutCount = hasCuts ? randInt(1, 2, rand) : 0;

        // Walk backwards from "today" to listedDate in ~weekly increments to
        // build a believable sync history (what the cron job would have
        // captured had it been running the whole time).
        const weeks = Math.max(1, Math.floor(daysAgoListed / 7));
        let priceAtStart = listPrice;
        if (cutCount > 0) {
          // Original price was higher; we'll step it down partway through history.
          const totalCutPct = cutCount === 1 ? 0.03 + rand() * 0.05 : 0.06 + rand() * 0.08;
          priceAtStart = Math.round((listPrice / (1 - totalCutPct)) / 500) * 500;
        }
        runningPrice = priceAtStart;
        const cutAtWeek = new Set<number>();
        while (cutAtWeek.size < cutCount && weeks > 2) {
          cutAtWeek.add(randInt(1, weeks - 1, rand));
        }
        const cutWeeksSorted = Array.from(cutAtWeek).sort((a, b) => a - b);
        let cutIdx = 0;
        const priceStep = cutCount > 0 ? (priceAtStart - listPrice) / (cutCount + 1) : 0;

        for (let w = weeks; w >= 0; w--) {
          const capturedAt = new Date(listedDate.getTime() + (daysAgoListed - w * 7) * DAY);
          if (capturedAt.getTime() > now) continue;
          if (cutIdx < cutWeeksSorted.length && weeks - w >= cutWeeksSorted[cutIdx]) {
            runningPrice = Math.round((runningPrice - priceStep) / 500) * 500;
            cutIdx++;
          }
          const domAtCapture = Math.round(((now - capturedAt.getTime()) < 0 ? 0 : (capturedAt.getTime() - listedDate.getTime()) / DAY));
          history.push({
            capturedAt: capturedAt.toISOString(),
            listPrice: w === 0 && status !== "SOLD" ? listPrice : runningPrice,
            status: w === 0 ? status : status === "SOLD" ? "ACTIVE" : status,
            daysOnMarket: Math.max(0, domAtCapture),
          });
        }
        if (history.length === 0 || history[history.length - 1].listPrice !== listPrice) {
          history.push({
            capturedAt: new Date(now - randInt(0, 2, rand) * DAY).toISOString(),
            listPrice,
            status,
            daysOnMarket,
          });
        }

        const town = townInfo;
        const transitBase = randInt(1, 12, rand);

        records.push({
          externalId: `mock-${counter}`,
          address: makeAddress(rand),
          town: town.name,
          county: town.county,
          zip: `07${randInt(1, 99, rand).toString().padStart(3, "0")}`.slice(0, 5),
          lat: null,
          lng: null,
          listPrice,
          beds,
          baths,
          sqft,
          lotSizeSqft,
          yearBuilt,
          propertyType,
          status,
          listedDate: listedDate.toISOString(),
          soldDate: soldDate ? soldDate.toISOString() : null,
          soldPrice,
          daysOnMarket,
          hoaFee: propertyType === "CONDO" || propertyType === "TOWNHOUSE" ? randInt(150, 650, rand) : null,
          garageSpaces: propertyType === "CONDO" ? (rand() < 0.5 ? randInt(0, 1, rand) : null) : randInt(0, 3, rand),
          transitStationName: town.nearestTransitStation,
          transitDistanceMiles: Math.round(transitBase * 10) / 10,
          schoolRating: Math.round((4 + rand() * 6) * 10) / 10,
          photoUrl: null,
          url: null,
          history,
        });
      }
    }
    return records;
  }
}
