import type { ListingStatus, PropertyType } from "@/types/listing";

/**
 * The shape every data source must normalize into before it enters the DB.
 * Field names deliberately mirror the Prisma `Listing` model minus DB-only
 * bookkeeping (id, timestamps) so a provider result can be upserted directly.
 */
export interface RawListing {
  externalId: string;
  address: string;
  town: string;
  county: string;
  zip: string;
  lat?: number | null;
  lng?: number | null;

  listPrice: number;
  beds: number;
  baths: number;
  sqft: number;
  lotSizeSqft?: number | null;
  yearBuilt?: number | null;
  propertyType: PropertyType;
  status: ListingStatus;

  listedDate: string; // ISO date
  soldDate?: string | null;
  soldPrice?: number | null;
  /** Optional precomputed DOM (used by the mock provider's synthetic history); providers normally omit this and let `ingestRawListing` derive it from `listedDate`. */
  daysOnMarket?: number;

  hoaFee?: number | null;
  garageSpaces?: number | null;
  transitStationName?: string | null;
  transitDistanceMiles?: number | null;
  schoolRating?: number | null;

  photoUrl?: string | null;
  url?: string | null;
}

export interface ListingProviderQuery {
  towns?: string[];
  /** County-level scoping (e.g. RentCastListingProvider) — one API call per county instead of per town. */
  counties?: string[];
  /** Max number of results this call should return (providers may page internally). */
  limit?: number;
  /** Hard per-area page cap (mainly a test/safety override); rate-limited providers otherwise paginate fully. */
  maxPagesPerArea?: number;
  /**
   * Called by rate-limited providers immediately before each network request.
   * Return `false` to deny it (the provider stops paginating and returns what
   * it has). This is how the RentCast monthly budget gates unbounded
   * pagination without the provider knowing anything about the quota system.
   */
  requestGate?: () => Promise<boolean>;
}

/**
 * Every listing data source (mock generator, RentCast, a RapidAPI reseller,
 * a Redfin CSV export...) implements this interface. The sync job and seed
 * script only ever talk to `ListingProvider`, never to a specific vendor's
 * API shape — that keeps swapping or combining sources a one-file change.
 */
export interface ListingProvider {
  /** Short key stored on `Listing.source`, e.g. "mock", "rentcast", "csv:redfin". */
  readonly key: string;

  /** Fetch current listings for the configured coverage area. */
  fetchListings(query?: ListingProviderQuery): Promise<RawListing[]>;
}
