import { MockListingProvider } from "./mockProvider";
import { RentCastListingProvider } from "./rentcastProvider";
import type { ListingProvider } from "./types";

export * from "./types";
export { MockListingProvider } from "./mockProvider";
export { RentCastListingProvider } from "./rentcastProvider";
export { CsvListingProvider } from "./csvProvider";

/**
 * Picks the active provider from `LISTING_PROVIDER` (defaults to "mock" so the
 * app works out of the box with zero configuration). Set LISTING_PROVIDER=rentcast
 * and RENTCAST_API_KEY in .env to switch to live data.
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
    case "mock":
    default:
      return new MockListingProvider();
  }
}
