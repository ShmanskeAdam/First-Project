import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildListingWhere, parseListingFilters } from "@/lib/filters";

/** Price-distribution histogram for the *currently filtered* result set. */
export async function GET(req: NextRequest) {
  const filters = parseListingFilters(req.nextUrl.searchParams);
  const where = buildListingWhere(filters);

  const listings = await prisma.listing.findMany({ where, select: { listPrice: true } });
  if (listings.length === 0) return NextResponse.json({ buckets: [], min: 0, max: 0 });

  const prices = listings.map((l) => l.listPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const bucketCount = 12;
  const bucketSize = Math.max(1, Math.ceil((max - min) / bucketCount / 5000) * 5000);

  const buckets = new Map<number, number>();
  for (const price of prices) {
    const bucketStart = Math.floor((price - min) / bucketSize) * bucketSize + min;
    buckets.set(bucketStart, (buckets.get(bucketStart) ?? 0) + 1);
  }

  const result = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStart, count]) => ({
      rangeStart: bucketStart,
      rangeEnd: bucketStart + bucketSize,
      count,
    }));

  return NextResponse.json({ buckets: result, min, max });
}
