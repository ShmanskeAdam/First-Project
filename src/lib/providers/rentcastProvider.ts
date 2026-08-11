import { getTownInfo, getCountySearchArea, isNorthNjCounty } from "@/lib/towns";
import type { PropertyType } from "@/types/listing";
import type { ListingProvider, ListingProviderQuery, RawListing } from "./types";

const RENTCAST_BASE_URL = "https://api.rentcast.io/v1";
const PAGE_SIZE = 500; // RentCast's max `limit` per request — fewer pages = fewer billed calls.
// No artificial listing cap: each county paginates until RentCast returns a
// non-full page (county exhausted). The real limiter is `query.requestGate`
// (the monthly budget), which can stop pagination mid-county; this constant is
// only a runaway-loop safety bound (20k listings/county — far beyond any real
// NJ county's active for-sale inventory).
const SAFETY_MAX_PAGES_PER_AREA = 40;

/** Thrown on 401/403 so callers can distinguish "bad key" from transient failures. */
export class RentCastAuthError extends Error {}

/**
 * RentCast API (https://www.rentcast.io/api) adapter. Requires RENTCAST_API_KEY
 * to be set — see .env.example.
 *
 * Queries one **circular area per county** (`latitude` + `longitude` + `radius`,
 * from `COUNTY_SEARCH_AREAS`). RentCast's `/listings/sale` supports searching by
 * address, by city/state/zip, or by circular area — there is **no county
 * filter**. Sending `county=…` gets silently ignored, degrading the request to
 * an unfiltered statewide query; that produced a tiny, mis-attributed dataset
 * (2 listings for a whole town) before this was fixed. Per-town queries would
 * be accurate but cost one request per municipality (~270 for North NJ), far
 * beyond the 50/month free tier, so circles are the efficient supported option.
 *
 * Each area paginates fully (no listing cap) and every row is attributed to the
 * county RentCast reports, with out-of-region rows dropped. `query.requestGate`
 * (wired to the monthly budget in runSync) bounds total requests, stopping
 * pagination mid-run if the budget is hit. `src/lib/syncRotation.ts` spreads the
 * daily automatic refresh across one county per day.
 *
 * Docs: GET /listings/sale — paginate with offset/limit (limit max 500; each
 * page is a separate billed request).
 */
export class RentCastListingProvider implements ListingProvider {
  readonly key = "rentcast";

  /** How many billed API requests the most recent fetchListings() call made — read by the quota meter. */
  lastFetchRequestCount = 0;

  /** True when the most recent fetchListings() stopped early because the requestGate denied a request (budget hit). */
  lastFetchGateDenied = false;

  /** Per-county kept-listing counts from the most recent fetch — surfaced in sync notes so coverage is auditable. */
  lastFetchCountyCounts: Record<string, number> = {};

  /** How many fetched rows were dropped as outside North NJ (radius spillover) or unusable. */
  lastFetchDiscarded = 0;

  constructor(private apiKey: string) {
    if (!apiKey) {
      throw new Error("RentCastListingProvider requires an API key (set RENTCAST_API_KEY)");
    }
  }

  async fetchListings(query?: ListingProviderQuery): Promise<RawListing[]> {
    const counties = query?.counties?.length ? query.counties : undefined;
    if (!counties) {
      throw new Error(
        "RentCastListingProvider.fetchListings requires an explicit county list — pass { counties: [...] } (see src/lib/towns.ts COUNTIES, or a single county from syncRotation for the daily-quota-safe path)."
      );
    }

    const maxPages = query?.maxPagesPerArea ?? SAFETY_MAX_PAGES_PER_AREA;
    const results: RawListing[] = [];
    this.lastFetchRequestCount = 0;
    this.lastFetchGateDenied = false;
    this.lastFetchCountyCounts = {};
    this.lastFetchDiscarded = 0;

    for (const county of counties) {
      const area = getCountySearchArea(county);
      if (!area) continue; // unknown county name — nothing sensible to query

      let offset = 0;
      for (let page = 0; page < maxPages; page++) {
        // Budget gate: ask permission for each request. A denial (monthly
        // budget exhausted) stops pagination cleanly — the county keeps
        // whatever pages it already pulled, the rest come on a later sync.
        if (query?.requestGate && !(await query.requestGate())) {
          this.lastFetchGateDenied = true;
          return results;
        }

        // Circular-area search (lat/long/radius) — a documented, supported
        // search mode. Do NOT send `county`: RentCast has no county filter on
        // this endpoint and silently ignores it, which turns every request
        // into an unfiltered statewide query.
        const params = new URLSearchParams({
          latitude: String(area.lat),
          longitude: String(area.lng),
          radius: String(area.radius),
          status: "Active",
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });

        this.lastFetchRequestCount++;
        const res = await fetch(`${RENTCAST_BASE_URL}/listings/sale?${params.toString()}`, {
          headers: {
            "X-Api-Key": this.apiKey,
            Accept: "application/json",
          },
        });

        if (res.status === 401 || res.status === 403) {
          throw new RentCastAuthError(`RentCast rejected the API key (HTTP ${res.status}).`);
        }
        if (!res.ok) {
          throw new Error(`RentCast request failed for ${county} County: ${res.status} ${res.statusText}`);
        }

        const data: unknown = await res.json();
        const items = Array.isArray(data) ? data : [];
        for (const item of items) {
          const mapped = mapRentCastListing(item, county);
          // null = outside the North NJ counties we track (a radius circle
          // always spills into neighbouring counties/states) or unusable.
          if (mapped) {
            results.push(mapped);
            this.lastFetchCountyCounts[mapped.county] = (this.lastFetchCountyCounts[mapped.county] ?? 0) + 1;
          } else {
            this.lastFetchDiscarded++;
          }
        }

        if (items.length < PAGE_SIZE) break; // last page for this area
        offset += PAGE_SIZE;
      }
    }

    return results;
  }
}

/** RentCast's raw response fields we care about, loosely typed since the API is not versioned/strict. */
interface RentCastListingRaw {
  id?: string;
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  /** RentCast returns the listing's real county — the authoritative source for attribution. */
  county?: string;
  state?: string;
  zipCode?: string;
  latitude?: number;
  longitude?: number;
  price?: number;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number;
  yearBuilt?: number;
  propertyType?: string;
  status?: string;
  listedDate?: string;
  daysOnMarket?: number;
  hoa?: { fee?: number };
  listingAgent?: unknown;
}

/**
 * Maps one RentCast row, or returns null to drop it.
 *
 * County attribution comes from RentCast's own `county` field — never from the
 * county we searched near. A radius search returns everything within the
 * circle, including neighbouring counties and other states, so trusting the
 * query would file listings under counties they aren't in (the old bug where
 * the town and county filters disagreed). Rows outside the tracked North NJ
 * counties are dropped here, which is also what keeps a spilling circle from
 * polluting the dataset.
 */
function mapRentCastListing(raw: RentCastListingRaw, searchedNearCounty: string): RawListing | null {
  if (!raw || (!raw.id && !raw.formattedAddress)) return null;
  const town = raw.city ?? "Unknown";
  const townInfo = getTownInfo(town);

  // 1. RentCast's own county. 2. Our curated town->county map. 3. As a last
  // resort for an NJ row with neither, the county whose circle we searched
  // (its centre), which is at least geographically adjacent.
  const reported = raw.county?.trim();
  const county = isNorthNjCounty(reported)
    ? reported
    : townInfo && isNorthNjCounty(townInfo.county)
      ? townInfo.county
      : !reported && (raw.state ?? "NJ") === "NJ"
        ? searchedNearCounty
        : null;
  if (!county || !isNorthNjCounty(county)) return null;

  return {
    externalId: String(raw.id ?? raw.formattedAddress),
    address: raw.addressLine1 ?? raw.formattedAddress ?? "Unknown address",
    town,
    county,
    zip: raw.zipCode ?? "",
    lat: raw.latitude ?? null,
    lng: raw.longitude ?? null,
    listPrice: raw.price ?? 0,
    beds: raw.bedrooms ?? 0,
    baths: raw.bathrooms ?? 0,
    sqft: raw.squareFootage ?? 0,
    lotSizeSqft: raw.lotSize ?? null,
    yearBuilt: raw.yearBuilt ?? null,
    propertyType: mapRentCastPropertyType(raw.propertyType),
    status: mapRentCastStatus(raw.status),
    listedDate: raw.listedDate ?? new Date().toISOString(),
    soldDate: null,
    soldPrice: null,
    hoaFee: raw.hoa?.fee ?? null,
    garageSpaces: null,
    transitStationName: townInfo?.nearestTransitStation ?? null,
    transitDistanceMiles: null,
    schoolRating: null,
    photoUrl: null,
    url: null,
  };
}

function mapRentCastPropertyType(raw?: string): PropertyType {
  const v = (raw ?? "").toLowerCase();
  if (v.includes("multi")) return "MULTI_FAMILY";
  if (v.includes("condo") || v.includes("apartment")) return "CONDO";
  if (v.includes("townhouse")) return "TOWNHOUSE";
  return "SINGLE_FAMILY";
}

function mapRentCastStatus(raw?: string): "ACTIVE" | "PENDING" | "SOLD" {
  const v = (raw ?? "").toLowerCase();
  if (v.includes("pending") || v.includes("contingent") || v.includes("under contract")) return "PENDING";
  if (v.includes("sold") || v.includes("closed")) return "SOLD";
  return "ACTIVE";
}
