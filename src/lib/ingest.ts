import { prisma } from "@/lib/db";
import type { RawListing } from "@/lib/providers/types";

/**
 * Batched ingestion: turns a provider's `RawListing[]` into DB rows in a
 * fixed ~8 queries total instead of ~4 per listing. The naive per-listing
 * loop (findUnique + upsert + snapshot per row) was ~3,000 sequential round
 * trips for a 700-listing sync — fine against a local DB, but guaranteed to
 * blow past serverless function time limits against a network-attached
 * Postgres (Neon) on Vercel. Steps:
 *
 *  1. Dedupe raws by externalId (a provider paginating can return the same
 *     property twice; last occurrence wins).
 *  2. One findMany for all existing rows of this source.
 *  3. createMany the genuinely new listings, then one findMany to learn
 *     their generated ids (needed for snapshots).
 *  4. Per-row updates ONLY for existing listings whose material fields
 *     actually changed (typically a handful per sync), chunked in
 *     transactions; plus one updateMany to bump lastSeenAt on the rest.
 *  5. createMany PriceChange rows for detected price moves.
 *  6. createMany one ListingSnapshot per ingested listing.
 *
 * Dedup across syncs is inherent to the (source, externalId) unique key —
 * re-syncing a property updates it in place, never duplicates it.
 */
export async function ingestRawListings(rawsInput: RawListing[], source: string) {
  const now = new Date();

  // 1. Dedupe within the batch.
  const bySrcId = new Map<string, RawListing>();
  for (const raw of rawsInput) bySrcId.set(raw.externalId, raw);
  const raws = Array.from(bySrcId.values());
  if (raws.length === 0) return [];

  const normalized = raws.map((raw) => {
    const listedDate = new Date(raw.listedDate);
    const referenceDate = raw.status === "SOLD" && raw.soldDate ? new Date(raw.soldDate) : now;
    const daysOnMarket =
      raw.daysOnMarket ?? Math.max(0, Math.round((referenceDate.getTime() - listedDate.getTime()) / 86_400_000));
    const pricePerSqft = raw.sqft > 0 ? Math.round((raw.listPrice / raw.sqft) * 100) / 100 : 0;
    return {
      source,
      externalId: raw.externalId,
      address: raw.address,
      town: raw.town,
      county: raw.county,
      zip: raw.zip,
      lat: raw.lat ?? null,
      lng: raw.lng ?? null,
      listPrice: raw.listPrice,
      pricePerSqft,
      beds: raw.beds,
      baths: raw.baths,
      sqft: raw.sqft,
      lotSizeSqft: raw.lotSizeSqft ?? null,
      yearBuilt: raw.yearBuilt ?? null,
      propertyType: raw.propertyType,
      status: raw.status,
      listedDate,
      soldDate: raw.soldDate ? new Date(raw.soldDate) : null,
      soldPrice: raw.soldPrice ?? null,
      daysOnMarket,
      hoaFee: raw.hoaFee ?? null,
      garageSpaces: raw.garageSpaces ?? null,
      transitStationName: raw.transitStationName ?? null,
      transitDistanceMiles: raw.transitDistanceMiles ?? null,
      schoolRating: raw.schoolRating ?? null,
      photoUrl: raw.photoUrl ?? null,
      url: raw.url ?? null,
      lastSeenAt: now,
    };
  });

  // 2. What already exists?
  const externalIds = normalized.map((n) => n.externalId);
  const existing = await prisma.listing.findMany({
    where: { source, externalId: { in: externalIds } },
    select: { id: true, externalId: true, listPrice: true, status: true, sqft: true, beds: true, baths: true, hoaFee: true },
  });
  const existingByExtId = new Map(existing.map((e) => [e.externalId, e]));

  const toCreate = normalized.filter((n) => !existingByExtId.has(n.externalId));
  const toExamine = normalized.filter((n) => existingByExtId.has(n.externalId));

  // 3. Insert new listings, then learn their ids.
  if (toCreate.length > 0) {
    await prisma.listing.createMany({ data: toCreate, skipDuplicates: true });
  }
  const createdRows =
    toCreate.length > 0
      ? await prisma.listing.findMany({
          where: { source, externalId: { in: toCreate.map((n) => n.externalId) } },
          select: { id: true, externalId: true },
        })
      : [];
  const idByExtId = new Map<string, string>(createdRows.map((r) => [r.externalId, r.id]));
  for (const e of existing) idByExtId.set(e.externalId, e.id);

  // 4. Update only the rows that materially changed; bulk-bump lastSeenAt on the rest.
  const changed = toExamine.filter((n) => {
    const prev = existingByExtId.get(n.externalId)!;
    return (
      prev.listPrice !== n.listPrice ||
      prev.status !== n.status ||
      prev.sqft !== n.sqft ||
      prev.beds !== n.beds ||
      prev.baths !== n.baths ||
      prev.hoaFee !== n.hoaFee
    );
  });
  const CHUNK = 50;
  for (let i = 0; i < changed.length; i += CHUNK) {
    await prisma.$transaction(
      changed.slice(i, i + CHUNK).map((n) =>
        prisma.listing.update({
          where: { source_externalId: { source, externalId: n.externalId } },
          data: n,
        })
      )
    );
  }
  const unchangedIds = toExamine
    .filter((n) => !changed.includes(n))
    .map((n) => idByExtId.get(n.externalId)!)
    .filter(Boolean);
  if (unchangedIds.length > 0) {
    await prisma.listing.updateMany({ where: { id: { in: unchangedIds } }, data: { lastSeenAt: now } });
  }

  // 5. Price-change events for detected moves.
  const priceChanges = toExamine
    .map((n) => {
      const prev = existingByExtId.get(n.externalId)!;
      if (prev.listPrice === n.listPrice) return null;
      return { listingId: prev.id, oldPrice: prev.listPrice, newPrice: n.listPrice, changedAt: now };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
  if (priceChanges.length > 0) {
    await prisma.priceChange.createMany({ data: priceChanges });
  }

  // 6. One snapshot per ingested listing — the raw material for every trend chart.
  const snapshots = normalized
    .map((n) => {
      const listingId = idByExtId.get(n.externalId);
      if (!listingId) return null;
      return {
        listingId,
        capturedAt: now,
        status: n.status,
        listPrice: n.listPrice,
        pricePerSqft: n.pricePerSqft,
        daysOnMarket: n.daysOnMarket,
        town: n.town,
        propertyType: n.propertyType,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
  if (snapshots.length > 0) {
    await prisma.listingSnapshot.createMany({ data: snapshots });
  }

  // Keep days-on-market fresh across the WHOLE table (not just today's synced
  // county) in one statement — active/pending DOM is purely derived from
  // listedDate, so it can be recomputed without touching any provider.
  await prisma.$executeRaw`
    UPDATE "Listing"
    SET "daysOnMarket" = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - "listedDate")) / 86400))::int
    WHERE "status" IN ('ACTIVE', 'PENDING')
  `;

  return normalized.map((n) => ({ externalId: n.externalId, id: idByExtId.get(n.externalId) }));
}

/**
 * Deletes any leftover seeded mock listings the first time a real provider
 * syncs, so switching from demo data to a live source is fully hands-off —
 * no separate manual "clear mock" step required. A no-op once none remain.
 */
/**
 * Deletes every listing for a source (cascading to its snapshots and price
 * changes). Used when a coverage change invalidates the stored dataset — rows
 * gathered under superseded query rules can carry wrong attribution, so they're
 * replaced wholesale rather than merged with freshly-pulled rows.
 */
export async function purgeListingsForSource(source: string): Promise<number> {
  const result = await prisma.listing.deleteMany({ where: { source } });
  return result.count;
}

export async function clearMockListingsIfLiveSource(activeSource: string): Promise<number> {
  if (activeSource === "mock") return 0;
  const result = await prisma.listing.deleteMany({ where: { source: "mock" } });
  return result.count;
}
