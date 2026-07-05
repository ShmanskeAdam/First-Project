import { getTownInfo } from "@/lib/towns";
import type { PropertyType } from "@/types/listing";
import type { ListingProvider, ListingProviderQuery, RawListing } from "./types";

const RENTCAST_BASE_URL = "https://api.rentcast.io/v1";

/**
 * RentCast API (https://www.rentcast.io/api) adapter. Requires RENTCAST_API_KEY
 * to be set — see .env.example. Free tier covers a limited number of calls/month,
 * so `fetchListings` is called per-town (not per-property) to stay well within it.
 *
 * Docs: GET /listings/sale — filter by city + state, paginate with offset/limit.
 */
export class RentCastListingProvider implements ListingProvider {
  readonly key = "rentcast";

  constructor(private apiKey: string) {
    if (!apiKey) {
      throw new Error("RentCastListingProvider requires an API key (set RENTCAST_API_KEY)");
    }
  }

  async fetchListings(query?: ListingProviderQuery): Promise<RawListing[]> {
    const towns = query?.towns?.length ? query.towns : undefined;
    if (!towns) {
      throw new Error(
        "RentCastListingProvider.fetchListings requires an explicit town list (RentCast has no bounding-box-by-county query)."
      );
    }

    const perTownLimit = query?.limit ?? 50;
    const results: RawListing[] = [];

    for (const town of towns) {
      const params = new URLSearchParams({
        city: town,
        state: "NJ",
        status: "Active",
        limit: String(perTownLimit),
      });

      const res = await fetch(`${RENTCAST_BASE_URL}/listings/sale?${params.toString()}`, {
        headers: {
          "X-Api-Key": this.apiKey,
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`RentCast request failed for ${town}: ${res.status} ${res.statusText}`);
      }

      const data: unknown = await res.json();
      const items = Array.isArray(data) ? data : [];
      for (const item of items) {
        const mapped = mapRentCastListing(item, town);
        if (mapped) results.push(mapped);
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

function mapRentCastListing(raw: RentCastListingRaw, fallbackTown: string): RawListing | null {
  if (!raw || (!raw.id && !raw.formattedAddress)) return null;
  const town = raw.city ?? fallbackTown;
  const townInfo = getTownInfo(town);

  return {
    externalId: String(raw.id ?? raw.formattedAddress),
    address: raw.addressLine1 ?? raw.formattedAddress ?? "Unknown address",
    town,
    county: townInfo?.county ?? "Unknown",
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
