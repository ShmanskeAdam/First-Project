import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * A single listing's full observed history: every sync snapshot (price, DOM,
 * status over time) plus its discrete price-change events. Powers the
 * price-history modal opened from any listing row.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const [snapshots, priceChanges] = await Promise.all([
    prisma.listingSnapshot.findMany({
      where: { listingId: params.id },
      orderBy: { capturedAt: "asc" },
      select: { capturedAt: true, listPrice: true, daysOnMarket: true, status: true },
    }),
    prisma.priceChange.findMany({
      where: { listingId: params.id },
      orderBy: { changedAt: "asc" },
      select: { oldPrice: true, newPrice: true, changedAt: true },
    }),
  ]);

  return NextResponse.json({
    snapshots: snapshots.map((s) => ({
      capturedAt: s.capturedAt.toISOString(),
      listPrice: s.listPrice,
      daysOnMarket: s.daysOnMarket,
      status: s.status,
    })),
    priceChanges: priceChanges.map((c) => ({
      oldPrice: c.oldPrice,
      newPrice: c.newPrice,
      changedAt: c.changedAt.toISOString(),
    })),
  });
}
