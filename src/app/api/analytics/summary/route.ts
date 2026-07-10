import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildListingWhere, parseListingFilters } from "@/lib/filters";
import { median, average } from "@/lib/stats";

export const dynamic = "force-dynamic";

export interface MarketSummary {
  activeCount: number;
  medianPrice: number;
  medianPricePerSqft: number;
  medianDom: number;
  priceCutShare: number; // 0-1, share of active listings with at least one cut
  /** Month-over-month deltas computed from snapshots (null when last month has no data). */
  momMedianPricePct: number | null;
  momInventoryPct: number | null;
  momDomDelta: number | null; // days
}

/**
 * Headline market stats for the analytics dashboard, respecting the current
 * town/type filters. "Now" numbers come from live Listing rows; the
 * month-over-month comparisons come from ListingSnapshot history (this
 * calendar month vs. the previous one).
 */
export async function GET(req: NextRequest) {
  const filters = parseListingFilters(req.nextUrl.searchParams);
  const where = { ...buildListingWhere(filters), status: "ACTIVE" as const };

  const active = await prisma.listing.findMany({
    where,
    select: { listPrice: true, pricePerSqft: true, daysOnMarket: true, priceChanges: { select: { id: true }, take: 1 } },
  });

  const now = new Date();
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const snapshots = await prisma.listingSnapshot.findMany({
    where: {
      capturedAt: { gte: lastMonthStart },
      status: "ACTIVE",
      ...(filters.towns?.length ? { town: { in: filters.towns } } : {}),
      ...(filters.propertyTypes?.length ? { propertyType: { in: filters.propertyTypes } } : {}),
    },
    select: { capturedAt: true, listPrice: true, daysOnMarket: true, listingId: true },
  });

  const thisMonth = snapshots.filter((s) => s.capturedAt >= thisMonthStart);
  const lastMonth = snapshots.filter((s) => s.capturedAt < thisMonthStart);

  const thisMedian = median(thisMonth.map((s) => s.listPrice));
  const lastMedian = median(lastMonth.map((s) => s.listPrice));
  const thisInv = new Set(thisMonth.map((s) => s.listingId)).size;
  const lastInv = new Set(lastMonth.map((s) => s.listingId)).size;
  const thisDom = median(thisMonth.map((s) => s.daysOnMarket));
  const lastDom = median(lastMonth.map((s) => s.daysOnMarket));

  const summary: MarketSummary = {
    activeCount: active.length,
    medianPrice: Math.round(median(active.map((l) => l.listPrice))),
    medianPricePerSqft: Math.round(median(active.map((l) => l.pricePerSqft))),
    medianDom: Math.round(median(active.map((l) => l.daysOnMarket))),
    priceCutShare: active.length > 0 ? average(active.map((l) => (l.priceChanges.length > 0 ? 1 : 0))) : 0,
    momMedianPricePct: lastMedian > 0 && thisMonth.length > 0 ? (thisMedian - lastMedian) / lastMedian : null,
    momInventoryPct: lastInv > 0 && thisMonth.length > 0 ? (thisInv - lastInv) / lastInv : null,
    momDomDelta: lastMonth.length > 0 && thisMonth.length > 0 ? Math.round(thisDom - lastDom) : null,
  };

  return NextResponse.json(summary);
}
