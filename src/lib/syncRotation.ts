import { COUNTIES } from "@/lib/towns";

/**
 * Deterministic "which county syncs today" picker for RentCast's free tier
 * (50 requests/month). Querying all 7 North NJ counties every time someone
 * clicks Refresh would cost 7+ requests per click — fine occasionally, but
 * multiple clicks a day would exhaust the monthly quota fast. Instead, the
 * automatic sync path (the site's Refresh button, and any cron hitting
 * POST /api/sync) only pulls ONE county per calendar day, rotating through
 * all 7 over a week: 1 request/day x 30 days = ~30 requests/month, safely
 * under the cap regardless of how many times Refresh gets clicked on a given
 * day (repeat clicks the same day re-sync the same county, not a new one).
 *
 * Full coverage is still reached — just on a rolling ~weekly basis per
 * county instead of instantaneously — which is a reasonable trade for
 * staying on a free API tier. For an immediate one-time full pull across all
 * counties (at the cost of more requests at once), use `npm run sync:full`
 * instead of the rotating default.
 */
export function getTodaysCounty(date: Date = new Date()): string {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - startOfYear) / 86_400_000);
  return COUNTIES[dayOfYear % COUNTIES.length];
}
