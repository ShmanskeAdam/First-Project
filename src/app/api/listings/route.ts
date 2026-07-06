import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildListingWhere, buildOrderBy, parseListingQuery } from "@/lib/filters";
import { serializeListing } from "@/lib/serialize";
import { scoreListingsById } from "@/lib/scoring/service";
import type { PaginatedListings, SortField } from "@/types/listing";

const DEAL_SCORE_SORT_FIELDS: SortField[] = ["dealScoreTown", "dealScoreNj"];

export async function GET(req: NextRequest) {
  const query = parseListingQuery(req.nextUrl.searchParams);
  const where = buildListingWhere(query);
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
  const sortDir = query.sortDir ?? "desc";

  if (query.sortField && DEAL_SCORE_SORT_FIELDS.includes(query.sortField)) {
    // Deal scores aren't DB columns — pull every matching row, score in memory, then paginate.
    const rows = await prisma.listing.findMany({ where, include: { priceChanges: true } });
    const scores = await scoreListingsById(rows.map((r) => r.id));
    const scoreKey = query.sortField === "dealScoreTown" ? "town" : "nj";
    const listings = rows
      .map((row) => ({ row, score: scores.get(row.id)?.[scoreKey]?.score ?? 0 }))
      .sort((a, b) => (sortDir === "asc" ? a.score - b.score : b.score - a.score))
      .slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
      .map(({ row }) => ({
        ...serializeListing(row),
        dealScoreTown: scores.get(row.id)?.town,
        dealScoreNj: scores.get(row.id)?.nj,
      }));

    const body: PaginatedListings = { listings, total: rows.length, page, pageSize };
    return NextResponse.json(body);
  }

  const orderBy = buildOrderBy(query.sortField, sortDir) ?? { listedDate: "desc" as const };

  const [total, rows] = await Promise.all([
    prisma.listing.count({ where }),
    prisma.listing.findMany({
      where,
      include: { priceChanges: true },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const scores = await scoreListingsById(rows.map((r) => r.id));
  const listings = rows.map((row) => ({
    ...serializeListing(row),
    dealScoreTown: scores.get(row.id)?.town,
    dealScoreNj: scores.get(row.id)?.nj,
  }));

  const body: PaginatedListings = { listings, total, page, pageSize };
  return NextResponse.json(body);
}
