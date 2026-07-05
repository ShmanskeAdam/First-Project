import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildListingWhere, parseListingFilters } from "@/lib/filters";
import { average, median } from "@/lib/stats";

export interface TownComparisonRow {
  town: string;
  avgPrice: number;
  avgPricePerSqft: number;
  avgDom: number;
  medianDom: number;
  activeCount: number;
}

/** Side-by-side town comparison (avg price, avg $/sqft, avg DOM) across a selected set of towns. */
export async function GET(req: NextRequest) {
  const townsParam = req.nextUrl.searchParams.get("towns");
  const towns = townsParam ? townsParam.split(",").filter(Boolean) : undefined;
  const filters = parseListingFilters(req.nextUrl.searchParams);
  const where = { ...buildListingWhere({ ...filters, towns }), status: "ACTIVE" as const };

  const listings = await prisma.listing.findMany({
    where,
    select: { town: true, listPrice: true, pricePerSqft: true, daysOnMarket: true },
  });

  const byTown = new Map<string, typeof listings>();
  for (const l of listings) {
    const arr = byTown.get(l.town);
    if (arr) arr.push(l);
    else byTown.set(l.town, [l]);
  }

  const rows: TownComparisonRow[] = Array.from(byTown.entries()).map(([town, group]) => ({
    town,
    avgPrice: Math.round(average(group.map((g) => g.listPrice))),
    avgPricePerSqft: Math.round(average(group.map((g) => g.pricePerSqft)) * 100) / 100,
    avgDom: Math.round(average(group.map((g) => g.daysOnMarket))),
    medianDom: Math.round(median(group.map((g) => g.daysOnMarket))),
    activeCount: group.length,
  }));

  rows.sort((a, b) => b.avgPrice - a.avgPrice);
  return NextResponse.json({ rows });
}
