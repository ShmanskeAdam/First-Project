import { getTownInfo } from "@/lib/towns";
import type { PropertyType } from "@/types/listing";
import type { ListingProvider, ListingProviderQuery, RawListing } from "./types";

const RENTCAST_BASE_URL = "https://api.rentcast.io/v1";
const PAGE_SIZE = 500; // RentCast's max `limit` per request — fewer pages = fewer billed calls.
const DEFAULT_MAX_PAGES_PER_AREA = 1; // 1 request per county by default; see fetchListings doc for why.

/**
 * RentCast API (https://www.rentcast.io/api) adapter. Requires RENTCAST_API_KEY
 * to be set — see .env.example.
 *
 * Queries by **county** (via `county` + `state` params), not by individual town —
 * RentCast's free tier caps out at 50 requests/month, and this app tracks 51 towns
 * across only 7 counties, so a per-town query (51 requests) would blow the entire
 * monthly quota in a single sync. Per-county queries (7 requests for a full sync)
 * make that math survivable; see `src/lib/syncRotation.ts` for how the daily
 * automatic Refresh click stays under quota by only syncing one county per day
 * rather than all 7 every time.
 *
 * Docs: GET /listings/sale — filter by county + state, paginate with offset/limit
 * (limit accepts up to 500; each page is a separate billed request).
 */
export class RentCastListingProvider implements ListingProvider {
  readonly key = "rentcast";

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

    const maxPages = query?.maxPagesPerArea ?? DEFAULT_MAX_PAGES_PER_AREA;
    const results: RawListing[] = [];

    for (const county of counties) {
      let offset = 0;
      for (let page = 0; page < maxPages; page++) {
        const params = new URLSearchParams({
          county,
          state: "NJ",
          status: "Active",
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });

        const res = await fetch(`${RENTCAST_BASE_URL}/listings/sale?${params.toString()}`, {
          headers: {
            "X-Api-Key": this.apiKey,
            Accept: "application/json",
          },
        });

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
