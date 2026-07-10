import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/runSync";

export const dynamic = "force-dynamic";
// Fluid-compute allowance; a county sync (up to 2 API pages + batched ingest)
// finishes in seconds, this is headroom for cold starts + slow upstream.
export const maxDuration = 60;

/**
 * Endpoint for Vercel Cron (configured in vercel.json, "0 9 * * *" — once
 * daily, the max frequency Vercel's Hobby plan allows). Vercel Cron always
 * sends GET with no custom headers, so auth works differently from
 * POST /api/sync:
 *
 * - If a CRON_SECRET env var is set, Vercel automatically attaches
 *   `Authorization: Bearer <CRON_SECRET>` to cron requests and we require it.
 * - If CRON_SECRET is NOT set, the endpoint stays open so the daily cron
 *   works with zero configuration. That's safe because runSync's own quota
 *   guards make abuse pointless: a stranger hammering this URL gets "already
 *   synced today" no-ops, bounded by the monthly request budget either way.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const status = await runSync("daily");
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
