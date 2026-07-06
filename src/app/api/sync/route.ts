import { NextRequest, NextResponse } from "next/server";
import { getActiveProvider, getDefaultSyncQuery } from "@/lib/providers";
import { ingestRawListings, clearMockListingsIfLiveSource } from "@/lib/ingest";
import { getSyncStatus, recordSyncStatus } from "@/lib/syncStatus";

export const dynamic = "force-dynamic";

// Manual refresh clicks from the public UI don't carry SYNC_SECRET (it can't be
// embedded in client-side JS without defeating its purpose), so this throttle is
// what actually protects a live provider from being hammered by site visitors.
const MIN_MANUAL_INTERVAL_MS = 30_000;

/** Read-only sync status for the "last refreshed" indicator — no auth, no side effects. */
export async function GET() {
  const status = await getSyncStatus();
  return NextResponse.json(status);
}

/**
 * Triggers a listings sync from the active provider. A request bearing a valid
 * `x-sync-secret` header (matching SYNC_SECRET) is treated as a trusted cron/CLI
 * caller and bypasses the throttle; anonymous calls (the UI's "Refresh" button)
 * are rate-limited instead of secret-gated, since the secret can't live in
 * client-side code.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  const provided = req.headers.get("x-sync-secret");
  const trusted = !!secret && secret !== "change-me" && provided === secret;

  if (!trusted) {
    const status = await getSyncStatus();
    if (status.lastSyncedAt) {
      const elapsedMs = Date.now() - new Date(status.lastSyncedAt).getTime();
      if (elapsedMs < MIN_MANUAL_INTERVAL_MS) {
        const retryAfterSeconds = Math.ceil((MIN_MANUAL_INTERVAL_MS - elapsedMs) / 1000);
        return NextResponse.json(
          { error: `Refreshed too recently. Try again in ${retryAfterSeconds}s.`, retryAfterSeconds },
          { status: 429 }
        );
      }
    }
  }

  try {
    const provider = getActiveProvider();
    const raws = await provider.fetchListings(getDefaultSyncQuery(provider));
    const results = await ingestRawListings(raws, provider.key);
    const clearedMockListings = await clearMockListingsIfLiveSource(provider.key);
    const status = await recordSyncStatus(provider.key, raws.length, results.length);
    return NextResponse.json({ ...status, clearedMockListings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
