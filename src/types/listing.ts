export type PropertyType = "SINGLE_FAMILY" | "MULTI_FAMILY" | "CONDO" | "TOWNHOUSE";
export type ListingStatus = "ACTIVE" | "PENDING" | "SOLD";

export interface PriceChangeEntry {
  id: string;
  oldPrice: number;
  newPrice: number;
  changedAt: string;
}

export interface Listing {
  id: string;
  source: string;
  externalId: string;
  address: string;
  town: string;
  county: string;
  zip: string;
  lat: number | null;
  lng: number | null;

  listPrice: number;
  pricePerSqft: number;
  beds: number;
  baths: number;
  sqft: number;
  lotSizeSqft: number | null;
  yearBuilt: number | null;
  propertyType: PropertyType;
  status: ListingStatus;

  listedDate: string;
  soldDate: string | null;
  soldPrice: number | null;
  daysOnMarket: number;

  hoaFee: number | null;
  garageSpaces: number | null;
  transitStationName: string | null;
  transitDistanceMiles: number | null;
  schoolRating: number | null;

  photoUrl: string | null;
  url: string | null;

  firstSeenAt: string;
  lastSeenAt: string;

  priceChanges: PriceChangeEntry[];

  /** Populated on read by the deal-scoring engine; not stored on the row itself. */
  dealScoreTown?: DealScoreResult;
  dealScoreNj?: DealScoreResult;
}

export interface ListingFilters {
  towns?: string[];
  counties?: string[];
  propertyTypes?: PropertyType[];
  statuses?: ListingStatus[];
  minPrice?: number;
  maxPrice?: number;
  minPricePerSqft?: number;
  maxPricePerSqft?: number;
  minBeds?: number;
  minBaths?: number;
  minSqft?: number;
  maxSqft?: number;
  minLotSize?: number;
  maxLotSize?: number;
  minYearBuilt?: number;
  maxYearBuilt?: number;
  minDom?: number;
  maxDom?: number;
  minSchoolRating?: number;
  priceCutOnly?: boolean;
  maxTransitDistanceMiles?: number;
  maxHoaFee?: number;
  minGarageSpaces?: number;
  search?: string;
}

export type SortField =
  | "listPrice"
  | "pricePerSqft"
  | "beds"
  | "baths"
  | "sqft"
  | "lotSizeSqft"
  | "yearBuilt"
  | "daysOnMarket"
  | "listedDate"
  | "dealScoreTown"
  | "dealScoreNj";

export interface ListingQuery extends ListingFilters {
  sortField?: SortField;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface PaginatedListings {
  listings: Listing[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DealScoreReason {
  label: string;
  detail: string;
  points: number;
}

export interface DealScoreResult {
  score: number; // 0-100
  reasons: DealScoreReason[];
}

export interface ScoringConfig {
  pricePerSqftWeight: number;
  priceCutWeight: number;
  domWeight: number;
  compSalesWeight: number;
  priceCutRecencyDays: number;
  compSaleLookbackMonths: number;
}

export interface FilterPreset {
  id: string;
  name: string;
  filters: ListingFilters;
  createdAt: string;
}
