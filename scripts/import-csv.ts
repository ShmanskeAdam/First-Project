/**
 * One-off importer for a Redfin "Download All" CSV export — no API key or
 * account required (see README's "Real data without an API key" section for
 * how to get the CSV). Upserts every row into the DB via the same ingest
 * path a live sync would use, so price-cut detection and snapshot history
 * work identically going forward.
 *
 * Usage:
 *   DATABASE_URL="<connection string>" npm run import:csv -- path/to/export.csv
 *
 * Run it once per town/county search — Redfin caps CSV exports at ~350 rows
 * without a (free) Redfin account, so North NJ-wide coverage usually means
 * several smaller exports rather than one giant one. Re-running with more
 * exports is safe; listings are upserted by address, not replaced wholesale.
 */
import fs from "node:fs";
import { CsvListingProvider } from "../src/lib/providers/csvProvider";
import { ingestRawListings } from "../src/lib/ingest";
import { recordSyncStatus } from "../src/lib/syncStatus";
import { prisma } from "../src/lib/db";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npm run import:csv -- <path-to-redfin-export.csv>");
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const csv = fs.readFileSync(filePath, "utf8");
  const provider = new CsvListingProvider(csv);
  const raws = await provider.fetchListings();
  console.log(`Parsed ${raws.length} listings from ${filePath}.`);

  if (raws.length === 0) {
    console.warn(
      "No listings parsed. Check that this is a Redfin 'Download All' CSV export (it needs the ADDRESS/CITY/PRICE/... header row Redfin includes by default) and that the CITY column matches a town name in src/lib/towns.ts exactly."
    );
    process.exit(1);
  }

  const results = await ingestRawListings(raws, provider.key);
  console.log(`Ingested ${results.length} listings (upserted + snapshotted).`);

  await recordSyncStatus(provider.key, raws.length, results.length);
  console.log("Recorded sync status — the site's 'Last refreshed' indicator will reflect this import.");
}

main()
  .catch((e) => {
    console.error("Import failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
