import { getTownInfo } from "@/lib/towns";
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
 * Queries by **county** (via `county` + `state` params), not by individual town —
 * a per-town query (51 towns) would cost far more requests than per-county
 * (7 counties) for the same coverage, and RentCast's free tier is only 50
 * requests/month. Each county paginates fully (no listing cap), so the entire
 * active for-sale inventory of North NJ is pulled; `query.requestGate` (wired
 * to the monthly budget in runSync) is what bounds total requests, stopping
 * pagination mid-run if the budget is hit. `src/lib/syncRotation.ts` spreads
 * the daily automatic refresh across one county per day.
 *
 * Docs: GET /listings/sale — filter by county + state, paginate with offset/limit
 * (limit accepts up to 500; each page is a separate billed request).
 */
export class RentCastListingProvider implements ListingProvider {
  readonly key = "rentcast";

  /** How many billed API requests the most recent fetchListings() call made — read by the quota meter. */
  lastFetchRequestCount = 0;

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

    for (const county of counties) {
      let offset = 0;
      for (let page = 0; page < maxPages; page++) {
        // Budget gate: ask permission for each request. A denial (monthly
        // budget exhausted) stops pagination cleanly — the county keeps
        // whatever pages it already pulled, the rest come on a later sync.
        if (query?.requestGate && !(await query.requestGate())) {
          return results;
        }

        const params = new URLSearchParams({
          county,
          state: "NJ",
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
          if (mapped) results.push(mapped);
        }

        if (items.length < PAGE_SIZE) break; // last page for this county
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

function mapRentCastListing(raw: RentCastListingRaw, queriedCounty: string): RawListing | null {
  if (!raw || (!raw.id && !raw.formattedAddress)) return null;
  const town = raw.city ?? "Unknown";
  const townInfo = getTownInfo(town);

  return {
    externalId: String(raw.id ?? raw.formattedAddress),
    address: raw.addressLine1 ?? raw.formattedAddress ?? "Unknown address",
    town,
    // Trust the county we queried by (the API already filtered on it) rather than a town
    // lookup, since RentCast may return towns/boroughs not present in our curated TOWNS list.
    county: queriedCounty,
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
