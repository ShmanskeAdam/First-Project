import { getActiveProvider, getDefaultSyncQuery } from "@/lib/providers";
import { ingestRawListings, clearMockListingsIfLiveSource } from "@/lib/ingest";
import { recordSyncStatus } from "@/lib/syncStatus";
import type { SyncTriggerResult } from "@/lib/syncStatus";

/**
 * The actual sync: fetch today's rotating query from the active provider,
 * ingest, clean up demo data if a live source just took over, and record
 * status. Shared by the UI-facing `POST /api/sync` (throttled, no auth) and
 * `GET /api/cron/sync` (Vercel Cron, authenticated via CRON_SECRET) so
 * there's exactly one place this logic lives.
 */
export async function runSync(): Promise<SyncTriggerResult> {
  const provider = getActiveProvider();
  const raws = await provider.fetchListings(getDefaultSyncQuery(provider));
  const results = await ingestRawListings(raws, provider.key);
  const clearedMockListings = await clearMockListingsIfLiveSource(provider.key);
  const status = await recordSyncStatus(provider.key, raws.length, results.length);
  return { ...status, clearedMockListings };
}
