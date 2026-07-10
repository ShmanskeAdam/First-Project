import { MockListingProvider } from "./mockProvider";
import { RentCastListingProvider } from "./rentcastProvider";
import type { ListingProvider, ListingProviderQuery } from "./types";
import { TOWN_NAMES, COUNTIES } from "@/lib/towns";
import { getTodaysCounty } from "@/lib/syncRotation";
import { getStoredRentcastKey } from "@/lib/appConfig";

export * from "./types";
export { MockListingProvider } from "./mockProvider";
export { RentCastListingProvider, RentCastAuthError } from "./rentcastProvider";
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
 * Picks the active provider. Resolution order:
 *
 * 1. A RentCast API key stored in the database (pasted into the site's own
 *    Settings page — see `src/lib/appConfig.ts`) → RentCast. This outranks
 *    every env var so going live requires zero Vercel-dashboard changes and
 *    zero redeploys: paste the key on /settings once and the very next sync
 *    is real data.
 * 2. `LISTING_PROVIDER=rentcast` + `RENTCAST_API_KEY` env vars → RentCast.
 * 3. `LISTING_PROVIDER=static` → no-op provider (used after a one-off CSV
 *    import so Refresh can't reintroduce mock data).
 * 4. Default → mock (the app works out of the box with zero configuration).
 */
export async function getActiveProvider(): Promise<ListingProvider> {
  const storedKey = await getStoredRentcastKey();
  if (storedKey) {
    return new RentCastListingProvider(storedKey);
  }

  const providerKey = process.env.LISTING_PROVIDER ?? "mock";

  switch (providerKey) {
    case "rentcast": {
      const apiKey = process.env.RENTCAST_API_KEY;
      if (!apiKey) {
        throw new Error(
          "LISTING_PROVIDER=rentcast requires RENTCAST_API_KEY to be set (or a key saved on the Settings page)."
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
    // 2 pages/county (1,000 listings) covers realistic active inventory while
    // keeping the worst case at 14 requests — small enough that the connect-time
    // full sync plus a month of daily rotation still fits the free tier.
    return { counties: COUNTIES.slice(), maxPagesPerArea: 2 };
  }
  return { towns: TOWN_NAMES };
}
