import { PrismaClient } from "@prisma/client";
import { MockListingProvider } from "../src/lib/providers/mockProvider";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database with mock North NJ listings...");

  await prisma.priceChange.deleteMany();
  await prisma.listingSnapshot.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.filterPreset.deleteMany();

  const provider = new MockListingProvider();
  const records = provider.generateWithHistory();

  let listingCount = 0;
  let snapshotCount = 0;
  let priceChangeCount = 0;

  for (const record of records) {
    const { history, ...raw } = record;
    const pricePerSqft = raw.sqft > 0 ? Math.round((raw.listPrice / raw.sqft) * 100) / 100 : 0;

    const listing = await prisma.listing.create({
      data: {
        source: "mock",
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
        listedDate: new Date(raw.listedDate),
        soldDate: raw.soldDate ? new Date(raw.soldDate) : null,
        soldPrice: raw.soldPrice ?? null,
        daysOnMarket: raw.daysOnMarket ?? 0,
        hoaFee: raw.hoaFee ?? null,
        garageSpaces: raw.garageSpaces ?? null,
        transitStationName: raw.transitStationName ?? null,
        transitDistanceMiles: raw.transitDistanceMiles ?? null,
        schoolRating: raw.schoolRating ?? null,
        photoUrl: raw.photoUrl ?? null,
        url: raw.url ?? null,
        firstSeenAt: new Date(history[0]?.capturedAt ?? raw.listedDate),
        lastSeenAt: new Date(history[history.length - 1]?.capturedAt ?? raw.listedDate),
      },
    });
    listingCount++;

    let prevPrice: number | null = null;
    for (const h of history) {
      const snapPpsf = raw.sqft > 0 ? Math.round((h.listPrice / raw.sqft) * 100) / 100 : 0;
      await prisma.listingSnapshot.create({
        data: {
          listingId: listing.id,
          capturedAt: new Date(h.capturedAt),
          status: h.status,
          listPrice: h.listPrice,
          pricePerSqft: snapPpsf,
          daysOnMarket: h.daysOnMarket,
          town: raw.town,
          propertyType: raw.propertyType,
        },
      });
      snapshotCount++;

      if (prevPrice !== null && prevPrice !== h.listPrice) {
        await prisma.priceChange.create({
          data: {
            listingId: listing.id,
            oldPrice: prevPrice,
            newPrice: h.listPrice,
            changedAt: new Date(h.capturedAt),
          },
        });
        priceChangeCount++;
      }
      prevPrice = h.listPrice;
    }
  }

  await prisma.scoringConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });

  console.log(
    `Seeded ${listingCount} listings, ${snapshotCount} snapshots, ${priceChangeCount} price changes.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
