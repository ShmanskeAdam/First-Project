import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeListing } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/**
 * The most recent price cuts across active listings — a "what just dropped"
 * feed for deal hunters, independent of the score model. One entry per
 * listing (its latest cut), newest first.
 */
export async function GET(req: NextRequest) {
  const limit = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 10)));

  const cuts = await prisma.priceChange.findMany({
    where: { listing: { status: "ACTIVE" }, newPrice: { lt: prisma.priceChange.fields.oldPrice } },
    orderBy: { changedAt: "desc" },
    take: limit * 3, // over-fetch, then keep one per listing
    include: { listing: { include: { priceChanges: true } } },
  });

  const seen = new Set<string>();
  const items = [];
  for (const cut of cuts) {
    if (seen.has(cut.listingId)) continue;
    seen.add(cut.listingId);
    items.push({
      listing: serializeListing(cut.listing),
      oldPrice: cut.oldPrice,
      newPrice: cut.newPrice,
      changedAt: cut.changedAt.toISOString(),
      cutPct: cut.oldPrice > 0 ? (cut.oldPrice - cut.newPrice) / cut.oldPrice : 0,
    });
    if (items.length >= limit) break;
  }

  return NextResponse.json({ cuts: items });
}
