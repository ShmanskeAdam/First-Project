import { prisma } from "@/lib/db";

export interface SyncStatusPayload {
  lastSyncedAt: string | null;
  provider: string | null;
  fetched: number | null;
  ingested: number | null;
}

/** POST /api/sync's response — the persisted status plus this call's one-off cleanup count. */
export interface SyncTriggerResult extends SyncStatusPayload {
  clearedMockListings: number;
}

export async function getSyncStatus(): Promise<SyncStatusPayload> {
  const row = await prisma.syncStatus.findUnique({ where: { id: "default" } });
  if (!row) return { lastSyncedAt: null, provider: null, fetched: null, ingested: null };
  return {
    lastSyncedAt: row.lastSyncedAt.toISOString(),
    provider: row.provider,
    fetched: row.fetched,
    ingested: row.ingested,
  };
}

export async function recordSyncStatus(provider: string, fetched: number, ingested: number): Promise<SyncStatusPayload> {
  const row = await prisma.syncStatus.upsert({
    where: { id: "default" },
    create: { id: "default", lastSyncedAt: new Date(), provider, fetched, ingested },
    update: { lastSyncedAt: new Date(), provider, fetched, ingested },
  });
  return {
    lastSyncedAt: row.lastSyncedAt.toISOString(),
    provider: row.provider,
    fetched: row.fetched,
    ingested: row.ingested,
  };
}
