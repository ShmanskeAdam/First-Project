import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_SCORING_CONFIG, getScoringConfig, updateScoringConfig } from "@/lib/scoring/config";

// Reads live DB state (scoring weights); must never be statically cached at build time.
export const dynamic = "force-dynamic";

export async function GET() {
  const config = await getScoringConfig();
  return NextResponse.json({ config, defaults: DEFAULT_SCORING_CONFIG });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
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
