import { MockListingProvider } from "./mockProvider";
import { RentCastListingProvider } from "./rentcastProvider";
import type { ListingProvider, ListingProviderQuery } from "./types";
import { TOWN_NAMES, COUNTIES } from "@/lib/towns";
import { getTodaysCounty } from "@/lib/syncRotation";

export * from "./types";
export { MockListingProvider } from "./mockProvider";
export { RentCastListingProvider } from "./rentcastProvider";
export { CsvListingProvider } from "./csvProvider";

/**
 * A provider that fetches nothing. Used for `LISTING_PROVIDER=static`, when
 * the DB has been populated once via a one-off script (e.g. `import-csv.ts`)
 * and there's no live source to poll — without this, the default "mock"
 * fallback would mean clicking the site's Refresh button silently
 * regenerates fake listings on top of real imported data.
 */
class StaticListingProvider implements ListingProvider {
  readonly key = "static";
  async fetchListings() {
    return [];
  }
}

/**
 * Picks the active provider from `LISTING_PROVIDER` (defaults to "mock" so the
 * app works out of the box with zero configuration). Set LISTING_PROVIDER=rentcast
 * and RENTCAST_API_KEY in .env to switch to live data, or LISTING_PROVIDER=static
 * after a one-off CSV import (see scripts/import-csv.ts) to stop the Refresh
 * button from doing anything at all rather than reintroducing mock data.
 */
export function getActiveProvider(): ListingProvider {
  const providerKey = process.env.LISTING_PROVIDER ?? "mock";

  switch (providerKey) {
    case "rentcast": {
      const apiKey = process.env.RENTCAST_API_KEY;
      if (!apiKey) {
        throw new Error(
          "LISTING_PROVIDER=rentcast requires RENTCAST_API_KEY to be set in your environment."
        );
      }
      return new RentCastListingProvider(apiKey);
    }
    case "static":
      return new StaticListingProvider();
    case "mock":
    default:
      return new MockListingProvider();
  }
}

/**
 * The query to use for an automatic sync (Refresh button click, or a cron job
 * without an explicit override): RentCast only pulls *today's* county — see
 * `syncRotation.ts` for why — while every other provider works from the full
 * town list as before (they aren't request-quota-constrained the same way).
 */
export function getDefaultSyncQuery(provider: ListingProvider): ListingProviderQuery {
  if (provider.key === "rentcast") {
    return { counties: [getTodaysCounty()] };
  }
  return { towns: TOWN_NAMES };
}

/**
 * The query for a deliberate, one-time full sync across all of North NJ in a
 * single run (`npm run sync:full`) — costs far more of RentCast's monthly
 * quota than the daily rotation, so it's opt-in only, not the automatic path.
 */
export function getFullSyncQuery(provider: ListingProvider): ListingProviderQuery {
  if (provider.key === "rentcast") {
    return { counties: COUNTIES.slice(), maxPagesPerArea: 5 };
  }
  return { towns: TOWN_NAMES };
}
