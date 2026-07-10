import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildListingWhere, parseListingFilters } from "@/lib/filters";

export const dynamic = "force-dynamic";

const EXPORT_CAP = 2000;

function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV download of every listing matching the current filters (capped at 2,000 rows). */
export async function GET(req: NextRequest) {
  const filters = parseListingFilters(req.nextUrl.searchParams);
  const where = buildListingWhere(filters);

  const rows = await prisma.listing.findMany({
    where,
    take: EXPORT_CAP,
    orderBy: { listedDate: "desc" },
    include: { priceChanges: { orderBy: { changedAt: "desc" }, take: 1 } },
  });

  const header = [
    "address", "town", "county", "zip", "status", "propertyType", "listPrice", "pricePerSqft",
    "beds", "baths", "sqft", "lotSizeSqft", "yearBuilt", "daysOnMarket", "listedDate",
    "lastPriceCut", "hoaFee", "garageSpaces", "transitStation", "transitMiles", "schoolRating", "url",
  ];
  const lines = [header.join(",")];
  for (const l of rows) {
    const cut = l.priceChanges[0];
    lines.push(
      [
        csvField(l.address), csvField(l.town), csvField(l.county), csvField(l.zip), csvField(l.status),
        csvField(l.propertyType), csvField(l.listPrice), csvField(l.pricePerSqft), csvField(l.beds),
        csvField(l.baths), csvField(l.sqft), csvField(l.lotSizeSqft), csvField(l.yearBuilt),
        csvField(l.daysOnMarket), csvField(l.listedDate.toISOString().slice(0, 10)),
        csvField(cut ? cut.newPrice - cut.oldPrice : ""), csvField(l.hoaFee), csvField(l.garageSpaces),
        csvField(l.transitStationName), csvField(l.transitDistanceMiles), csvField(l.schoolRating), csvField(l.url),
      ].join(",")
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nnj-listings-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
