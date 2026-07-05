/**
 * Pulls fresh listings from the currently configured provider (see
 * LISTING_PROVIDER in .env) and appends them to the price-history tables.
 * Run manually with `npm run sync`, or schedule it (OS cron, a systemd timer,
 * Vercel Cron hitting /api/sync, etc.) to keep the historical snapshots —
 * and therefore the trend charts — up to date.
 */
import { getActiveProvider } from "../src/lib/providers";
import { ingestRawListings } from "../src/lib/ingest";
import { TOWN_NAMES } from "../src/lib/towns";
import { prisma } from "../src/lib/db";
import { recordSyncStatus } from "../src/lib/syncStatus";

async function main() {
  const provider = getActiveProvider();
  console.log(`Syncing listings via provider "${provider.key}"...`);

  const raws = await provider.fetchListings({ towns: TOWN_NAMES });
  console.log(`Fetched ${raws.length} listings.`);

  const results = await ingestRawListings(raws, provider.key);
  console.log(`Ingested ${results.length} listings (upserted + snapshotted).`);

  await recordSyncStatus(provider.key, raws.length, results.length);
}

main()
  .catch((e) => {
    console.error("Sync failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
