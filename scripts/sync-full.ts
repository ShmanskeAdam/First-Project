/**
 * One-time (or occasional, deliberate) full sync across every North NJ
 * county at once — unlike the day-rotating default (`npm run sync` /
 * clicking Refresh, which only pulls one county per day to stay within
 * RentCast's free 50-requests/month cap), this pulls all 7 counties in a
 * single run. Costs roughly 7-35 requests (1-5 pages per county depending on
 * how many active listings each county has) — fine to run once when you
 * first set up a live provider so the site has full coverage immediately,
 * but running it often will burn through the monthly quota fast.
 *
 * Usage: DATABASE_URL="..." RENTCAST_API_KEY="..." npm run sync:full
 */
import { getActiveProvider, getFullSyncQuery } from "../src/lib/providers";
import { ingestRawListings, clearMockListingsIfLiveSource } from "../src/lib/ingest";
import { prisma } from "../src/lib/db";
import { recordSyncStatus } from "../src/lib/syncStatus";

async function main() {
  const provider = getActiveProvider();
  const query = getFullSyncQuery(provider);
  console.log(`Full sync via provider "${provider.key}"...`, query.counties ? `(counties: ${query.counties.join(", ")})` : "");

  const raws = await provider.fetchListings(query);
  console.log(`Fetched ${raws.length} listings.`);

  const results = await ingestRawListings(raws, provider.key);
  console.log(`Ingested ${results.length} listings (upserted + snapshotted).`);

  const cleared = await clearMockListingsIfLiveSource(provider.key);
  if (cleared > 0) console.log(`Cleared ${cleared} leftover mock listings now that a live source is active.`);

  await recordSyncStatus(provider.key, raws.length, results.length);
}

main()
  .catch((e) => {
    console.error("Full sync failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
