import { prisma } from "@/lib/db";
import type { RawListing } from "@/lib/providers/types";

/**
 * Upserts a single provider result into the DB: updates the current-state
 * `Listing` row, records a `PriceChange` if the list price moved since the
 * last sync, and appends one `ListingSnapshot` capturing "what we saw right
 * now" — the row that powers every historical trend chart. Used by the
 * recurring sync job (scripts/sync-listings.ts); the seed script bypasses
 * this in favor of backfilling many synthetic snapshots at once.
 */
export async function ingestRawListing(raw: RawListing, source: string) {
  const existing = await prisma.listing.findUnique({
    where: { source_externalId: { source, externalId: raw.externalId } },
  });

  const listedDate = new Date(raw.listedDate);
  const now = new Date();
  const referenceDate = raw.status === "SOLD" && raw.soldDate ? new Date(raw.soldDate) : now;
  const daysOnMarket = Math.max(
    0,
    Math.round((referenceDate.getTime() - listedDate.getTime()) / 86_400_000)
  );
  const pricePerSqft = raw.sqft > 0 ? Math.round((raw.listPrice / raw.sqft) * 100) / 100 : 0;

  const data = {
    source,
    externalId: raw.externalId,
    address: raw.address,
    town: raw.town,
    county: raw.county,
    zip: raw.zip,
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    listPrice: raw.listPrice,
    pricePerSqft,
    beds: raw.beds,
    baths: raw.baths,
    sqft: raw.sqft,
    lotSizeSqft: raw.lotSizeSqft ?? null,
    yearBuilt: raw.yearBuilt ?? null,
    propertyType: raw.propertyType,
    status: raw.status,
    listedDate,
    soldDate: raw.soldDate ? new Date(raw.soldDate) : null,
    soldPrice: raw.soldPrice ?? null,
    daysOnMarket,
    hoaFee: raw.hoaFee ?? null,
    garageSpaces: raw.garageSpaces ?? null,
    transitStationName: raw.transitStationName ?? null,
    transitDistanceMiles: raw.transitDistanceMiles ?? null,
    schoolRating: raw.schoolRating ?? null,
    photoUrl: raw.photoUrl ?? null,
    url: raw.url ?? null,
    lastSeenAt: now,
  };

  const listing = await prisma.listing.upsert({
    where: { source_externalId: { source, externalId: raw.externalId } },
    create: data,
    update: data,
  });

  if (existing && existing.listPrice !== raw.listPrice) {
    await prisma.priceChange.create({
      data: {
        listingId: listing.id,
        oldPrice: existing.listPrice,
        newPrice: raw.listPrice,
        changedAt: now,
      },
    });
  }

  await prisma.listingSnapshot.create({
    data: {
      listingId: listing.id,
      capturedAt: now,
      status: raw.status,
      listPrice: raw.listPrice,
      pricePerSqft,
      daysOnMarket,
      town: raw.town,
      propertyType: raw.propertyType,
    },
  });

  return listing;
}

export async function ingestRawListings(raws: RawListing[], source: string) {
  const results = [];
  for (const raw of raws) {
    results.push(await ingestRawListing(raw, source));
  }
  return results;
}

/**
 * Deletes any leftover seeded mock listings the first time a real provider
 * syncs, so switching from demo data to a live source is fully hands-off —
 * no separate manual "clear mock" step required. A no-op once none remain.
 */
export async function clearMockListingsIfLiveSource(activeSource: string): Promise<number> {
  if (activeSource === "mock") return 0;
  const result = await prisma.listing.deleteMany({ where: { source: "mock" } });
  return result.count;
}
