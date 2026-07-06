import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/runSync";

export const dynamic = "force-dynamic";

/**
 * Dedicated endpoint for Vercel Cron (configured in vercel.json, "0 9 * * *" —
 * once daily, the max frequency Vercel's Hobby/free plan allows). Vercel Cron
 * always sends a GET request and cannot attach custom headers like
 * `x-sync-secret`, so this can't reuse `POST /api/sync`'s throttle-or-secret
 * check — instead it checks the `Authorization: Bearer <CRON_SECRET>` header
 * Vercel automatically attaches to cron-triggered requests when a
 * `CRON_SECRET` env var is set. Runs the same `runSync()` as everything else,
 * so it inherits the same RentCast daily-county-rotation quota safety.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = await runSync();
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
