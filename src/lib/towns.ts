// Configurable/extendable list of North NJ municipalities this tracker covers.
// Add a town by adding one entry here — everything else (filters, seed data
// generation, town-comparison charts) reads from this list.

/** The North NJ counties this tracker covers. */
export const COUNTIES = [
  "Bergen",
  "Essex",
  "Hudson",
  "Morris",
  "Passaic",
  "Union",
  "Somerset",
  "Sussex",
  "Warren",
  "Hunterdon",
] as const;

export type County = (typeof COUNTIES)[number];

/** Fast membership test used to discard out-of-region listings a radius search pulls in. */
const COUNTY_SET: ReadonlySet<string> = new Set(COUNTIES);

export function isNorthNjCounty(county: string | null | undefined): county is County {
  return !!county && COUNTY_SET.has(county);
}

/**
 * Circular search areas, one per county — how the RentCast provider actually
 * queries listings.
 *
 * RentCast's `/listings/sale` supports searching by address, by city/state/zip,
 * or by a **circular geographical area** (latitude + longitude + radius). It
 * does NOT support a `county` filter: passing `county=Essex&state=NJ` silently
 * ignores the county and matches on the state alone, returning a statewide
 * slice. (That bug is exactly why the app once showed 2 Montclair listings and
 * filed towns under the wrong counties.) Per-county circles are the supported
 * way to get real geographic partitioning without paying one request per town.
 *
 * Radii are sized to cover each county's full extent, so circles overlap and
 * spill past county/state lines. Both are harmless: ingestion dedupes on
 * `(source, externalId)`, and every listing is attributed to the county
 * RentCast itself reports, with anything outside `COUNTIES` discarded.
 */
export interface CountySearchArea {
  county: County;
  lat: number;
  lng: number;
  /** Miles; sized to cover the whole county from its centroid. */
  radius: number;
}

export const COUNTY_SEARCH_AREAS: CountySearchArea[] = [
  { county: "Bergen", lat: 40.96, lng: -74.07, radius: 11 },
  { county: "Essex", lat: 40.79, lng: -74.25, radius: 10 },
  { county: "Hudson", lat: 40.73, lng: -74.07, radius: 8 },
  { county: "Morris", lat: 40.86, lng: -74.55, radius: 15 },
  { county: "Passaic", lat: 41.03, lng: -74.3, radius: 15 },
  { county: "Union", lat: 40.66, lng: -74.31, radius: 10 },
  { county: "Somerset", lat: 40.56, lng: -74.62, radius: 14 },
  { county: "Sussex", lat: 41.14, lng: -74.69, radius: 16 },
  { county: "Warren", lat: 40.86, lng: -74.99, radius: 15 },
  { county: "Hunterdon", lat: 40.57, lng: -74.91, radius: 15 },
];

export function getCountySearchArea(county: string): CountySearchArea | undefined {
  return COUNTY_SEARCH_AREAS.find((a) => a.county === county);
}

export interface TownInfo {
  name: string;
  county: County;
  /** Rough driving distance in miles to the nearest NJ Transit / PATH station, used to seed mock commute data. */
  nearestTransitStation: string;
}

export const TOWNS: TownInfo[] = [
  // Bergen
  { name: "Ridgewood", county: "Bergen", nearestTransitStation: "Ridgewood Station" },
  { name: "Hackensack", county: "Bergen", nearestTransitStation: "Essex Street" },
  { name: "Englewood", county: "Bergen", nearestTransitStation: "Englewood Route 4" },
  { name: "Fort Lee", county: "Bergen", nearestTransitStation: "GWB Bus Terminal" },
  { name: "Paramus", county: "Bergen", nearestTransitStation: "Ridgewood Station" },
  { name: "Teaneck", county: "Bergen", nearestTransitStation: "Teaneck Route 4" },
  { name: "Tenafly", county: "Bergen", nearestTransitStation: "Englewood Route 4" },
  { name: "Wyckoff", county: "Bergen", nearestTransitStation: "Ridgewood Station" },
  { name: "Glen Rock", county: "Bergen", nearestTransitStation: "Glen Rock Main Line" },
  { name: "Ramsey", county: "Bergen", nearestTransitStation: "Ramsey Route 17" },

  // Essex
  { name: "Montclair", county: "Essex", nearestTransitStation: "Montclair Heights" },
  { name: "Glen Ridge", county: "Essex", nearestTransitStation: "Glen Ridge Station" },
  { name: "Bloomfield", county: "Essex", nearestTransitStation: "Bloomfield Station" },
  { name: "Nutley", county: "Essex", nearestTransitStation: "Nutley Station" },
  { name: "Maplewood", county: "Essex", nearestTransitStation: "Maplewood Station" },
  { name: "South Orange", county: "Essex", nearestTransitStation: "South Orange Station" },
  { name: "Millburn", county: "Essex", nearestTransitStation: "Millburn Station" },
  { name: "Short Hills", county: "Essex", nearestTransitStation: "Short Hills Station" },
  { name: "West Orange", county: "Essex", nearestTransitStation: "Highland Avenue" },
  { name: "Livingston", county: "Essex", nearestTransitStation: "Millburn Station" },
  { name: "Verona", county: "Essex", nearestTransitStation: "Montclair Heights" },
  { name: "Newark", county: "Essex", nearestTransitStation: "Newark Penn Station" },

  // Hudson
  { name: "Hoboken", county: "Hudson", nearestTransitStation: "Hoboken Terminal" },
  { name: "Jersey City", county: "Hudson", nearestTransitStation: "Grove Street PATH" },
  { name: "Weehawken", county: "Hudson", nearestTransitStation: "Port Imperial" },
  { name: "Union City", county: "Hudson", nearestTransitStation: "Bergenline Ave" },
  { name: "Bayonne", county: "Hudson", nearestTransitStation: "8th Street Light Rail" },
  { name: "Secaucus", county: "Hudson", nearestTransitStation: "Secaucus Junction" },

  // Morris
  { name: "Morristown", county: "Morris", nearestTransitStation: "Morristown Station" },
  { name: "Madison", county: "Morris", nearestTransitStation: "Madison Station" },
  { name: "Chatham", county: "Morris", nearestTransitStation: "Chatham Station" },
  { name: "Parsippany-Troy Hills", county: "Morris", nearestTransitStation: "Morris Plains Station" },
  { name: "Montville", county: "Morris", nearestTransitStation: "Lincoln Park Station" },
  { name: "Denville", county: "Morris", nearestTransitStation: "Denville Station" },

  // Passaic
  { name: "Clifton", county: "Passaic", nearestTransitStation: "Clifton Station" },
  { name: "Wayne", county: "Passaic", nearestTransitStation: "Mountain View Station" },
  { name: "Paterson", county: "Passaic", nearestTransitStation: "Paterson Station" },
  { name: "Ridgewood-Passaic Line", county: "Passaic", nearestTransitStation: "Glen Rock Main Line" },
  { name: "Little Falls", county: "Passaic", nearestTransitStation: "Little Falls Station" },

  // Union
  { name: "Westfield", county: "Union", nearestTransitStation: "Westfield Station" },
  { name: "Summit", county: "Union", nearestTransitStation: "Summit Station" },
  { name: "Cranford", county: "Union", nearestTransitStation: "Cranford Station" },
  { name: "Union", county: "Union", nearestTransitStation: "Union Station" },
  { name: "Rahway", county: "Union", nearestTransitStation: "Rahway Station" },
  { name: "Scotch Plains", county: "Union", nearestTransitStation: "Fanwood Station" },
  { name: "Clark", county: "Union", nearestTransitStation: "Clark Station" },

  // Somerset
  { name: "Somerville", county: "Somerset", nearestTransitStation: "Raritan Station" },
  { name: "Bridgewater", county: "Somerset", nearestTransitStation: "Bridgewater Station" },
  { name: "Bernards", county: "Somerset", nearestTransitStation: "Basking Ridge Station" },
  { name: "Warren", county: "Somerset", nearestTransitStation: "Gladstone Station" },
  { name: "Hillsborough", county: "Somerset", nearestTransitStation: "Raritan Station" },

  // Sussex
  { name: "Newton", county: "Sussex", nearestTransitStation: "Netcong Station" },
  { name: "Sparta", county: "Sussex", nearestTransitStation: "Netcong Station" },
  { name: "Vernon", county: "Sussex", nearestTransitStation: "Netcong Station" },
  { name: "Hopatcong", county: "Sussex", nearestTransitStation: "Lake Hopatcong Station" },

  // Warren
  { name: "Hackettstown", county: "Warren", nearestTransitStation: "Hackettstown Station" },
  { name: "Phillipsburg", county: "Warren", nearestTransitStation: "Hackettstown Station" },
  { name: "Washington", county: "Warren", nearestTransitStation: "Hackettstown Station" },

  // Hunterdon
  { name: "Flemington", county: "Hunterdon", nearestTransitStation: "Raritan Station" },
  { name: "Clinton", county: "Hunterdon", nearestTransitStation: "High Bridge Station" },
  { name: "Lambertville", county: "Hunterdon", nearestTransitStation: "Trenton Transit Center" },
  { name: "Readington", county: "Hunterdon", nearestTransitStation: "White House Station" },
];

/**
 * A town as offered to the filter UI. Unlike `TownInfo` this is deliberately
 * loose (`county` is a plain string), because the real filter options are
 * derived from whatever towns actually exist in the synced data — which, for
 * live RentCast data, spans hundreds of NJ municipalities well beyond the
 * curated `TOWNS` seed list. See `GET /api/towns`.
 */
export interface TownOption {
  name: string;
  county: string;
}

export const TOWN_NAMES = TOWNS.map((t) => t.name);

export function getTownInfo(name: string): TownInfo | undefined {
  return TOWNS.find((t) => t.name === name);
}
