/**
 * Deliberate full sync across every North NJ county at once (`npm run
 * sync:full`) — unlike the day-rotating default, this pulls all 7 counties in
 * a single run (up to ~14 RentCast requests). Same implementation as every
 * other sync path (src/lib/runSync.ts), so the monthly request budget still
 * applies: a run that would exceed it is refused rather than overrunning the
 * free tier.
 *
 * Usage: DATABASE_URL="..." npm run sync:full
 * (Uses the RentCast key saved on the Settings page, or RENTCAST_API_KEY env.)
 */
import { runSync } from "../src/lib/runSync";
import { prisma } from "../src/lib/db";

async function main() {
  const result = await runSync("full");
  if (result.skipped) {
    console.log(`Skipped: ${result.note}`);
  } else {
    console.log(`Full sync via "${result.provider}": fetched ${result.fetched}, ingested ${result.ingested}.`);
    if (result.note) console.log(result.note);
  }
}

main()
  .catch((e) => {
    console.error("Full sync failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
