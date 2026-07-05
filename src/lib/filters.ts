import type { Prisma } from "@prisma/client";
import type { ListingFilters, ListingQuery, PropertyType, ListingStatus, SortField } from "@/types/listing";

function csv(param: string | null): string[] | undefined {
  if (!param) return undefined;
  const vals = param.split(",").map((v) => v.trim()).filter(Boolean);
  return vals.length ? vals : undefined;
}

function num(param: string | null): number | undefined {
  if (param === null || param === "") return undefined;
  const n = Number(param);
  return Number.isFinite(n) ? n : undefined;
}

/** Parses the common ListingFilters query params shared by /api/listings and the analytics endpoints. */
export function parseListingFilters(searchParams: URLSearchParams): ListingFilters {
  return {
    towns: csv(searchParams.get("towns")),
    counties: csv(searchParams.get("counties")),
    propertyTypes: csv(searchParams.get("propertyTypes")) as PropertyType[] | undefined,
    statuses: csv(searchParams.get("statuses")) as ListingStatus[] | undefined,
    minPrice: num(searchParams.get("minPrice")),
    maxPrice: num(searchParams.get("maxPrice")),
    minPricePerSqft: num(searchParams.get("minPricePerSqft")),
    maxPricePerSqft: num(searchParams.get("maxPricePerSqft")),
    minBeds: num(searchParams.get("minBeds")),
    minBaths: num(searchParams.get("minBaths")),
    minSqft: num(searchParams.get("minSqft")),
    maxSqft: num(searchParams.get("maxSqft")),
    minLotSize: num(searchParams.get("minLotSize")),
    maxLotSize: num(searchParams.get("maxLotSize")),
    minYearBuilt: num(searchParams.get("minYearBuilt")),
    maxYearBuilt: num(searchParams.get("maxYearBuilt")),
    minDom: num(searchParams.get("minDom")),
    maxDom: num(searchParams.get("maxDom")),
    minSchoolRating: num(searchParams.get("minSchoolRating")),
    priceCutOnly: searchParams.get("priceCutOnly") === "true",
    maxTransitDistanceMiles: num(searchParams.get("maxTransitDistanceMiles")),
    maxHoaFee: num(searchParams.get("maxHoaFee")),
    minGarageSpaces: num(searchParams.get("minGarageSpaces")),
    search: searchParams.get("search") ?? undefined,
  };
}

export function parseListingQuery(searchParams: URLSearchParams): ListingQuery {
  const filters = parseListingFilters(searchParams);
  return {
    ...filters,
    sortField: (searchParams.get("sortField") as SortField | null) ?? undefined,
    sortDir: (searchParams.get("sortDir") as "asc" | "desc" | null) ?? undefined,
    page: num(searchParams.get("page")),
    pageSize: num(searchParams.get("pageSize")),
  };
}

/** Builds the Prisma where-clause for `ListingFilters`. Shared by the listings, deals, and analytics endpoints. */
export function buildListingWhere(filters: ListingFilters): Prisma.ListingWhereInput {
  const where: Prisma.ListingWhereInput = {};

  if (filters.towns?.length) where.town = { in: filters.towns };
  if (filters.counties?.length) where.county = { in: filters.counties };
  if (filters.propertyTypes?.length) where.propertyType = { in: filters.propertyTypes };
  if (filters.statuses?.length) where.status = { in: filters.statuses };

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    where.listPrice = { gte: filters.minPrice, lte: filters.maxPrice };
  }
  if (filters.minPricePerSqft !== undefined || filters.maxPricePerSqft !== undefined) {
    where.pricePerSqft = { gte: filters.minPricePerSqft, lte: filters.maxPricePerSqft };
  }
  if (filters.minBeds !== undefined) where.beds = { gte: filters.minBeds };
  if (filters.minBaths !== undefined) where.baths = { gte: filters.minBaths };
  if (filters.minSqft !== undefined || filters.maxSqft !== undefined) {
    where.sqft = { gte: filters.minSqft, lte: filters.maxSqft };
  }
  if (filters.minLotSize !== undefined || filters.maxLotSize !== undefined) {
    where.lotSizeSqft = { gte: filters.minLotSize, lte: filters.maxLotSize };
  }
  if (filters.minYearBuilt !== undefined || filters.maxYearBuilt !== undefined) {
    where.yearBuilt = { gte: filters.minYearBuilt, lte: filters.maxYearBuilt };
  }
  if (filters.minDom !== undefined || filters.maxDom !== undefined) {
    where.daysOnMarket = { gte: filters.minDom, lte: filters.maxDom };
  }
  if (filters.minSchoolRating !== undefined) where.schoolRating = { gte: filters.minSchoolRating };
  if (filters.priceCutOnly) where.priceChanges = { some: {} };
  if (filters.maxTransitDistanceMiles !== undefined) {
    where.transitDistanceMiles = { lte: filters.maxTransitDistanceMiles };
  }
  if (filters.maxHoaFee !== undefined) {
    where.OR = [{ hoaFee: null }, { hoaFee: { lte: filters.maxHoaFee } }];
  }
  if (filters.minGarageSpaces !== undefined) where.garageSpaces = { gte: filters.minGarageSpaces };
  if (filters.search) {
    // Postgres `contains` is case-sensitive by default, unlike SQLite's default TEXT collation.
    where.address = { contains: filters.search, mode: "insensitive" };
  }

  return where;
}

const SORT_FIELD_MAP: Record<Exclude<SortField, "dealScore">, string> = {
  listPrice: "listPrice",
  pricePerSqft: "pricePerSqft",
  beds: "beds",
  baths: "baths",
  sqft: "sqft",
  lotSizeSqft: "lotSizeSqft",
  yearBuilt: "yearBuilt",
  daysOnMarket: "daysOnMarket",
  listedDate: "listedDate",
};

/** `dealScore` isn't a DB column (it's computed post-query), so callers must sort in-memory for that case. */
export function buildOrderBy(sortField?: SortField, sortDir: "asc" | "desc" = "desc"): Prisma.ListingOrderByWithRelationInput | undefined {
  if (!sortField || sortField === "dealScore") return undefined;
  const column = SORT_FIELD_MAP[sortField];
  return { [column]: sortDir };
}
