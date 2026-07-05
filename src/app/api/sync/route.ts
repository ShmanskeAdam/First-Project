import { NextRequest, NextResponse } from "next/server";
import { getActiveProvider } from "@/lib/providers";
import { ingestRawListings } from "@/lib/ingest";
import { TOWN_NAMES } from "@/lib/towns";

/**
 * Triggers a listings sync from the active provider. Protected by SYNC_SECRET
 * so it can be wired to a cron service (Vercel Cron, an OS cron hitting this
 * URL, etc.) without exposing it to the public internet.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  const provided = req.headers.get("x-sync-secret");
  if (secret && secret !== "change-me" && provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const provider = getActiveProvider();
    const raws = await provider.fetchListings({ towns: TOWN_NAMES });
    const results = await ingestRawListings(raws, provider.key);
    return NextResponse.json({ provider: provider.key, fetched: raws.length, ingested: results.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
