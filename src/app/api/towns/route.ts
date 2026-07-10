import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { TOWNS, COUNTIES, type TownOption } from "@/lib/towns";

export const dynamic = "force-dynamic";

/**
 * The town filter options. These are derived from the towns that actually
 * exist in the synced data (distinct `town` + `county` on `Listing`), NOT from
 * a hardcoded list — that's what makes town filtering work with live RentCast
 * data (which covers hundreds of NJ municipalities like Boonton, Mountain
 * Lakes, etc. that were never in the curated seed list) and guarantees every
 * option matches a real stored value exactly, so selecting it always filters.
 * Falls back to the curated `TOWNS` seed list only when the DB has no listings
 * yet (fresh install before the first sync).
 */
export async function GET() {
  const grouped = await prisma.listing.groupBy({
    by: ["town", "county"],
    _count: { _all: true },
    orderBy: [{ county: "asc" }, { town: "asc" }],
  });

  let towns: TownOption[];
  const countiesInData = new Set<string>();

  if (grouped.length > 0) {
    towns = grouped
      .filter((g) => g.town && g.town.trim() !== "")
      .map((g) => {
        countiesInData.add(g.county);
        return { name: g.town, county: g.county };
      });
  } else {
    towns = TOWNS.map((t) => ({ name: t.name, county: t.county }));
  }

  // Prefer the canonical 7-county order; append any extra counties present in data.
  const counties = [
    ...COUNTIES.filter((c) => countiesInData.size === 0 || countiesInData.has(c)),
    ...Array.from(countiesInData).filter((c) => !COUNTIES.includes(c as (typeof COUNTIES)[number])).sort(),
  ];

  return NextResponse.json({ towns, counties });
}
