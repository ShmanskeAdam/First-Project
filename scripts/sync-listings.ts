/**
 * Daily sync entrypoint (`npm run sync`) — same code path as the site's
 * Refresh button and the Vercel Cron job (src/lib/runSync.ts), so it carries
 * the same RentCast quota guards: one rotating county per day, hard monthly
 * request budget. For an immediate full pull across every county, use
 * `npm run sync:full` instead.
 */
import { runSync } from "../src/lib/runSync";
import { prisma } from "../src/lib/db";

async function main() {
  const result = await runSync("daily");
  if (result.skipped) {
    console.log(`Skipped: ${result.note}`);
  } else {
    console.log(`Synced via "${result.provider}": fetched ${result.fetched}, ingested ${result.ingested}.`);
    if (result.note) console.log(result.note);
  }
}

main()
  .catch((e) => {
    console.error("Sync failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
