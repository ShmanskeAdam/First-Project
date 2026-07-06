/**
 * Deletes every listing sourced from the mock generator (source === "mock"),
 * along with their ListingSnapshot/PriceChange rows (cascade). Run this once
 * before or after your first real-data import (CSV or RentCast) so the site
 * doesn't show a mix of fake demo listings and real ones.
 *
 * Usage: DATABASE_URL="<connection string>" npm run clear:mock
 */
import { prisma } from "../src/lib/db";

async function main() {
  const result = await prisma.listing.deleteMany({ where: { source: "mock" } });
  console.log(`Deleted ${result.count} mock listings (their snapshots and price changes cascade-deleted too).`);
}

main()
  .catch((e) => {
    console.error("Clear failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
