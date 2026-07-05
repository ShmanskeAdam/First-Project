import { getTownInfo } from "@/lib/towns";
import type { PropertyType } from "@/types/listing";
import type { ListingProvider, ListingProviderQuery, RawListing } from "./types";

/**
 * Redfin's "Download All" CSV export (a feature Redfin explicitly permits)
 * as a `ListingProvider`. Point it at a CSV path and it normalizes rows into
 * `RawListing`s the same way any other provider does — the rest of the app
 * doesn't know or care the data came from a file instead of an API.
 *
 * Expected columns (Redfin's standard export header names):
 * ADDRESS, CITY, STATE, ZIP OR POSTAL CODE, PRICE, BEDS, BATHS,
 * SQUARE FEET, LOT SIZE, YEAR BUILT, PROPERTY TYPE, DAYS ON MARKET,
 * STATUS, URL, LATITUDE, LONGITUDE, MLS#
 */
export class CsvListingProvider implements ListingProvider {
  readonly key = "csv:redfin";

  constructor(private csvText: string) {}

  async fetchListings(query?: ListingProviderQuery): Promise<RawListing[]> {
    const rows = parseCsv(this.csvText);
    if (rows.length === 0) return [];

    const header = rows[0].map((h) => h.trim().toUpperCase());
    const idx = (name: string) => header.indexOf(name);

    const col = {
      address: idx("ADDRESS"),
      city: idx("CITY"),
      zip: idx("ZIP OR POSTAL CODE"),
      price: idx("PRICE"),
      beds: idx("BEDS"),
      baths: idx("BATHS"),
      sqft: idx("SQUARE FEET"),
      lot: idx("LOT SIZE"),
      yearBuilt: idx("YEAR BUILT"),
      propertyType: idx("PROPERTY TYPE"),
      dom: idx("DAYS ON MARKET"),
      status: idx("STATUS"),
      url: idx("URL"),
      lat: idx("LATITUDE"),
      lng: idx("LONGITUDE"),
      mls: idx("MLS#"),
      soldDate: idx("SOLD DATE"),
    };

    const out: RawListing[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (r.length < 2) continue;
      const city = col.city >= 0 ? r[col.city]?.trim() : undefined;
      const townInfo = city ? getTownInfo(city) : undefined;
      if (!city) continue;
      if (query?.towns?.length && !query.towns.includes(city)) continue;

      const sqft = Number(col.sqft >= 0 ? r[col.sqft] : 0) || 0;
      const price = Number(col.price >= 0 ? r[col.price] : 0) || 0;
      const statusRaw = (col.status >= 0 ? r[col.status] : "").toUpperCase();

      out.push({
        externalId: (col.mls >= 0 && r[col.mls]) || `redfin-${col.address >= 0 ? r[col.address] : i}`,
        address: col.address >= 0 ? r[col.address] : `Unknown address ${i}`,
        town: city,
        county: townInfo?.county ?? "Unknown",
        zip: col.zip >= 0 ? r[col.zip] : "",
        lat: col.lat >= 0 ? Number(r[col.lat]) || null : null,
        lng: col.lng >= 0 ? Number(r[col.lng]) || null : null,
        listPrice: price,
        beds: Number(col.beds >= 0 ? r[col.beds] : 0) || 0,
        baths: Number(col.baths >= 0 ? r[col.baths] : 0) || 0,
        sqft,
        lotSizeSqft: col.lot >= 0 ? Number(r[col.lot]) || null : null,
        yearBuilt: col.yearBuilt >= 0 ? Number(r[col.yearBuilt]) || null : null,
        propertyType: mapRedfinPropertyType(col.propertyType >= 0 ? r[col.propertyType] : ""),
        status: mapRedfinStatus(statusRaw),
        listedDate: new Date().toISOString(),
        soldDate: col.soldDate >= 0 && r[col.soldDate] ? new Date(r[col.soldDate]).toISOString() : null,
        soldPrice: statusRaw.includes("SOLD") ? price : null,
        hoaFee: null,
        garageSpaces: null,
        transitStationName: townInfo?.nearestTransitStation ?? null,
        transitDistanceMiles: null,
        schoolRating: null,
        photoUrl: null,
        url: col.url >= 0 ? r[col.url] : null,
      });
    }
    return out;
  }
}

function mapRedfinPropertyType(raw: string): PropertyType {
  const v = raw.toUpperCase();
  if (v.includes("MULTI")) return "MULTI_FAMILY";
  if (v.includes("CONDO")) return "CONDO";
  if (v.includes("TOWNHOUSE")) return "TOWNHOUSE";
  return "SINGLE_FAMILY";
}

function mapRedfinStatus(raw: string): "ACTIVE" | "PENDING" | "SOLD" {
  if (raw.includes("SOLD")) return "SOLD";
  if (raw.includes("PENDING") || raw.includes("CONTINGENT")) return "PENDING";
  return "ACTIVE";
}

/** Minimal RFC4180 CSV parser: handles quoted fields, escaped quotes, and commas within quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
