import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { average, median } from "@/lib/stats";

export interface TrendPoint {
  month: string; // "YYYY-MM"
  town: string;
  medianPrice: number;
  avgPricePerSqft: number;
  activeCount: number;
  medianDom: number;
}

/**
 * Time-series data for the analytics dashboard: median price, avg $/sqft,
 * active inventory count, and median DOM, grouped by month and town, derived
 * from ListingSnapshot rows (one per listing per sync). `towns` is optional —
 * omit it to get one aggregate series covering every tracked town.
 */
export async function GET(req: NextRequest) {
  const townsParam = req.nextUrl.searchParams.get("towns");
  const towns = townsParam ? townsParam.split(",").filter(Boolean) : undefined;
  const years = Number(req.nextUrl.searchParams.get("years") ?? "3");
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - (Number.isFinite(years) ? years : 3));

  const snapshots = await prisma.listingSnapshot.findMany({
    where: {
      capturedAt: { gte: cutoff },
      ...(towns?.length ? { town: { in: towns } } : {}),
    },
    select: {
      listingId: true,
      capturedAt: true,
      town: true,
      status: true,
      listPrice: true,
      pricePerSqft: true,
      daysOnMarket: true,
    },
  });

  const useAggregate = !towns?.length;
  const groups = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const month = s.capturedAt.toISOString().slice(0, 7);
    const townKey = useAggregate ? "All North NJ" : s.town;
    const key = `${month}|${townKey}`;
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }

  const series: TrendPoint[] = [];
  for (const [key, group] of groups) {
    const [month, town] = key.split("|");
    const activeIds = new Set(group.filter((g) => g.status === "ACTIVE").map((g) => g.listingId));
    const nonSoldDom = group.filter((g) => g.status !== "SOLD").map((g) => g.daysOnMarket);
    series.push({
      month,
      town,
      medianPrice: Math.round(median(group.map((g) => g.listPrice))),
      avgPricePerSqft: Math.round(average(group.map((g) => g.pricePerSqft)) * 100) / 100,
      activeCount: activeIds.size,
      medianDom: Math.round(median(nonSoldDom)),
    });
  }

  series.sort((a, b) => a.month.localeCompare(b.month) || a.town.localeCompare(b.town));
  return NextResponse.json({ series });
}
