import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildListingWhere, parseListingFilters } from "@/lib/filters";
import { serializeListing } from "@/lib/serialize";
import { scoreAllActiveListings } from "@/lib/scoring/service";

/** Top Deals leaderboard: every active listing (optionally filtered), ranked by deal score descending. */
export async function GET(req: NextRequest) {
  const filters = parseListingFilters(req.nextUrl.searchParams);
  const where = { ...buildListingWhere(filters), status: "ACTIVE" as const };
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50)));

  const [{ scores }, matching] = await Promise.all([
    scoreAllActiveListings(),
    prisma.listing.findMany({ where, select: { id: true } }),
  ]);

  const matchingIds = new Set(matching.map((m) => m.id));
  const ranked = Array.from(scores.entries())
    .filter(([id]) => matchingIds.has(id))
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit);

  const rows = await prisma.listing.findMany({
    where: { id: { in: ranked.map(([id]) => id) } },
    include: { priceChanges: true },
  });
  const rowById = new Map(rows.map((r) => [r.id, r]));

  const listings = ranked
    .map(([id, dealScore]) => {
      const row = rowById.get(id);
      if (!row) return null;
      return { ...serializeListing(row), dealScore };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  return NextResponse.json({ listings, total: ranked.length });
}
