import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_SCORING_CONFIG, getScoringConfig, updateScoringConfig } from "@/lib/scoring/config";
import { getStoredRentcastKey, setStoredRentcastKey, getRentcastUsage } from "@/lib/appConfig";
import { runSync } from "@/lib/runSync";
import { RentCastAuthError } from "@/lib/providers";
import type { SyncRunResult } from "@/lib/runSync";

// Reads live DB state (scoring weights, data-source status); must never be
// statically cached at build time.
export const dynamic = "force-dynamic";
// The PUT handler can trigger a connect-time full sync (up to 14 upstream
// requests + a bulk ingest), so give it fluid-compute headroom.
export const maxDuration = 60;

async function dataSourceStatus() {
  const storedKey = await getStoredRentcastKey();
  const usage = await getRentcastUsage();
  const envRentcast = process.env.LISTING_PROVIDER === "rentcast" && !!process.env.RENTCAST_API_KEY;
  return {
    // Write-only: report that a key exists (and its last 4 chars for recognition), never the key itself.
    rentcastConfigured: !!storedKey || envRentcast,
    rentcastKeyHint: storedKey ? `••••${storedKey.slice(-4)}` : envRentcast ? "(from environment)" : null,
    rentcastUsage: usage,
  };
}

export async function GET() {
  const [config, source] = await Promise.all([getScoringConfig(), dataSourceStatus()]);
  return NextResponse.json({ config, defaults: DEFAULT_SCORING_CONFIG, dataSource: source });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();

  // --- Data-source management -------------------------------------------
  // Saving a RentCast key immediately validates it with a full sync so the
  // user sees real data (and the demo listings get auto-cleared) the moment
  // they click Connect — no cron wait, no redeploy. A rejected key (401/403
  // from RentCast) is removed again and reported instead of being kept
  // around silently broken.
  if (typeof body.rentcastApiKey === "string") {
    const key = body.rentcastApiKey.trim();
    if (key === "") {
      await setStoredRentcastKey(null);
      const source = await dataSourceStatus();
      return NextResponse.json({ dataSource: source, sync: null });
    }

    await setStoredRentcastKey(key);
    let sync: SyncRunResult | null = null;
    try {
      sync = await runSync("full");
    } catch (err) {
      if (err instanceof RentCastAuthError) {
        await setStoredRentcastKey(null);
        return NextResponse.json(
          { error: "RentCast rejected this API key — double-check it in your RentCast dashboard." },
          { status: 400 }
        );
      }
      // Key stored but the initial sync hit a transient error; the daily cron
      // will retry automatically. Report without failing the connect.
      const message = err instanceof Error ? err.message : "Initial sync failed";
      const source = await dataSourceStatus();
      return NextResponse.json({
        dataSource: source,
        sync: null,
        warning: `Key saved, but the initial pull failed (${message}). The daily automatic sync will retry.`,
      });
    }
    const source = await dataSourceStatus();
    return NextResponse.json({ dataSource: source, sync });
  }

  // --- Scoring weights ----------------------------------------------------
  const allowedKeys = [
    "pricePerSqftWeight",
    "priceCutWeight",
    "domWeight",
    "compSalesWeight",
    "priceCutRecencyDays",
    "compSaleLookbackMonths",
  ] as const;

  const patch: Record<string, number> = {};
  for (const key of allowedKeys) {
    if (typeof body[key] === "number" && Number.isFinite(body[key])) {
      patch[key] = body[key];
    }
  }

  const config = await updateScoringConfig(patch);
  return NextResponse.json({ config });
}
