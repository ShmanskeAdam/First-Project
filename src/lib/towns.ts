// Configurable/extendable list of North NJ municipalities this tracker covers.
// Add a town by adding one entry here — everything else (filters, seed data
// generation, town-comparison charts) reads from this list.

export interface TownInfo {
  name: string;
  county:
    | "Bergen"
    | "Essex"
    | "Hudson"
    | "Morris"
    | "Passaic"
    | "Union"
    | "Somerset";
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
];

export const TOWN_NAMES = TOWNS.map((t) => t.name);

export const COUNTIES = [
  "Bergen",
  "Essex",
  "Hudson",
  "Morris",
  "Passaic",
  "Union",
  "Somerset",
] as const;

export function getTownInfo(name: string): TownInfo | undefined {
  return TOWNS.find((t) => t.name === name);
}
