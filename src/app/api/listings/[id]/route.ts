import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeListing } from "@/lib/serialize";
import { scoreListingsById } from "@/lib/scoring/service";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const row = await prisma.listing.findUnique({
    where: { id: params.id },
    include: { priceChanges: true },
  });
  if (!row) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

  const scores = await scoreListingsById([row.id]);
  return NextResponse.json({ ...serializeListing(row), dealScore: scores.get(row.id) });
}
