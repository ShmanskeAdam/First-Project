import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildListingWhere, parseListingFilters } from "@/lib/filters";
import { serializeListing } from "@/lib/serialize";
import { scoreAllActiveListings } from "@/lib/scoring/service";

/**
 * Top Deals leaderboard: every active listing (optionally filtered), ranked by deal score
 * descending. `rankBy=town` (default) ranks by the town-comps score; `rankBy=nj` ranks by the
 * NJ-wide score instead. Both scores are always included on each returned listing regardless.
 */
export async function GET(req: NextRequest) {
  const filters = parseListingFilters(req.nextUrl.searchParams);
  // Enforce a $1/sqft floor so land-only listings (no house → sqft 0 →
  // pricePerSqft 0) never surface as "deals". A user can still raise the floor
  // above 1 via the filter, but never drop it below 1 here.
  filters.minPricePerSqft = Math.max(1, filters.minPricePerSqft ?? 1);
  const where = { ...buildListingWhere(filters), status: "ACTIVE" as const };
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50)));
  const rankBy = req.nextUrl.searchParams.get("rankBy") === "nj" ? "nj" : "town";

  const [{ scores }, matching] = await Promise.all([
    scoreAllActiveListings(),
    prisma.listing.findMany({ where, select: { id: true } }),
  ]);

  const matchingIds = new Set(matching.map((m) => m.id));
  const ranked = Array.from(scores.entries())
    .filter(([id]) => matchingIds.has(id))
    .sort((a, b) => b[1][rankBy].score - a[1][rankBy].score)
    .slice(0, limit);

  const rows = await prisma.listing.findMany({
    where: { id: { in: ranked.map(([id]) => id) } },
    include: { priceChanges: true },
  });
  const rowById = new Map(rows.map((r) => [r.id, r]));

  const listings = ranked
    .map(([id, dualScore]) => {
      const row = rowById.get(id);
      if (!row) return null;
      return { ...serializeListing(row), dealScoreTown: dualScore.town, dealScoreNj: dualScore.nj };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  return NextResponse.json({ listings, total: ranked.length });
}
