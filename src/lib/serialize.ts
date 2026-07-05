import type { Listing as PrismaListing, PriceChange as PrismaPriceChange } from "@prisma/client";
import type { Listing } from "@/types/listing";

type ListingWithPriceChanges = PrismaListing & { priceChanges: PrismaPriceChange[] };

export function serializeListing(listing: ListingWithPriceChanges): Listing {
  return {
    id: listing.id,
    source: listing.source,
    externalId: listing.externalId,
    address: listing.address,
    town: listing.town,
    county: listing.county,
    zip: listing.zip,
    lat: listing.lat,
    lng: listing.lng,
    listPrice: listing.listPrice,
    pricePerSqft: listing.pricePerSqft,
    beds: listing.beds,
    baths: listing.baths,
    sqft: listing.sqft,
    lotSizeSqft: listing.lotSizeSqft,
    yearBuilt: listing.yearBuilt,
    propertyType: listing.propertyType as Listing["propertyType"],
    status: listing.status as Listing["status"],
    listedDate: listing.listedDate.toISOString(),
    soldDate: listing.soldDate ? listing.soldDate.toISOString() : null,
    soldPrice: listing.soldPrice,
    daysOnMarket: listing.daysOnMarket,
    hoaFee: listing.hoaFee,
    garageSpaces: listing.garageSpaces,
    transitStationName: listing.transitStationName,
    transitDistanceMiles: listing.transitDistanceMiles,
    schoolRating: listing.schoolRating,
    photoUrl: listing.photoUrl,
    url: listing.url,
    firstSeenAt: listing.firstSeenAt.toISOString(),
    lastSeenAt: listing.lastSeenAt.toISOString(),
    priceChanges: listing.priceChanges
      .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())
      .map((c) => ({
        id: c.id,
        oldPrice: c.oldPrice,
        newPrice: c.newPrice,
        changedAt: c.changedAt.toISOString(),
      })),
  };
}
