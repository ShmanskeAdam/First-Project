/**
 * Answers "why is listing X / town Y missing?" definitively, by asking RentCast
 * directly and comparing against what this app stored.
 *
 * It distinguishes the three very different causes:
 *   1. RentCast genuinely doesn't have the listing (they're not an MLS feed —
 *      they aggregate public records/directories, so gaps vs. Zillow exist).
 *   2. RentCast has it, but our query filters it out (e.g. `status=Active`
 *      excludes pending/coming-soon/sold).
 *   3. RentCast has it and our query would return it, but it never reached the
 *      DB (sync hasn't run since a fix, or budget truncated pagination).
 *
 * Costs ~4 RentCast requests, metered against the same monthly budget as every
 * other path, so it cannot blow the free tier.
 *
 * Usage:
 *   npm run diagnose                                  # defaults to Montclair
 *   npm run diagnose -- --town "Montclair"
 *   npm run diagnose -- --town "Montclair" --address "88 Edgemont Rd, Montclair, NJ 07043"
 */
import { prisma } from "../src/lib/db";
import { getStoredRentcastKey, reserveRentcastRequest, getRentcastUsage } from "../src/lib/appConfig";
import { getCountySearchArea, getTownInfo } from "../src/lib/towns";

const BASE = "https://api.rentcast.io/v1/listings/sale";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

interface Row {
  id?: string;
  formattedAddress?: string;
  city?: string;
  county?: string;
  state?: string;
  status?: string;
  price?: number;
  listedDate?: string;
  removedDate?: string;
}

async function call(apiKey: string, params: Record<string, string>, label: string): Promise<Row[] | null> {
  if (!(await reserveRentcastRequest())) {
    console.log(`   ⚠ skipped "${label}" — monthly API budget exhausted.`);
    console.log(`     Raise RENTCAST_MONTHLY_BUDGET temporarily to finish diagnosing.`);
    return null;
  }
  const url = `${BASE}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { headers: { "X-Api-Key": apiKey, Accept: "application/json" } });
  if (!res.ok) {
    console.log(`   ✗ ${label}: HTTP ${res.status} ${res.statusText}`);
    return null;
  }
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as Row[]) : [];
}

function tally(rows: Row[], key: keyof Row): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = String(r[key] ?? "(none)");
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`)
    .join(", ");
}

async function main() {
  const town = arg("town", "Montclair")!;
  const address = arg("address");

  const apiKey = (await getStoredRentcastKey()) ?? process.env.RENTCAST_API_KEY;
  if (!apiKey) {
    console.error("No RentCast API key found (Settings page or RENTCAST_API_KEY).");
    process.exit(1);
  }

  const usage = await getRentcastUsage();
  console.log(`RentCast coverage diagnostic — town: ${town}`);
  console.log(`API budget before: ${usage.used}/${usage.budget} this month\n`);

  // --- What this app currently has stored -------------------------------
  const dbTotal = await prisma.listing.count();
  const dbTown = await prisma.listing.count({ where: { town } });
  const dbTownActive = await prisma.listing.count({ where: { town, status: "ACTIVE" } });
  const sources = await prisma.listing.groupBy({ by: ["source"], _count: { _all: true } });
  const cfg = await prisma.appConfig.findUnique({ where: { id: "default" } });
  const sync = await prisma.syncStatus.findUnique({ where: { id: "default" } });
  console.log("1) In this app's database");
  console.log(`   total listings: ${dbTotal} (${sources.map((s) => `${s.source}=${s._count._all}`).join(", ") || "none"})`);
  console.log(`   ${town}: ${dbTown} (${dbTownActive} active)`);
  console.log(`   last sync: ${sync?.lastSyncedAt?.toISOString() ?? "never"} via ${sync?.provider ?? "-"}`);
  console.log(`   last full pull: ${cfg?.lastFullSyncAt?.toISOString() ?? "never"}`);
  console.log(`   coverage signature: ${cfg?.fullSyncCoverage ?? "(none)"}\n`);

  // --- 2. Does RentCast have this exact address? ------------------------
  if (address) {
    console.log(`2) RentCast, exact address: "${address}"`);
    const rows = await call(apiKey, { address }, "address lookup");
    if (rows) {
      if (rows.length === 0) {
        console.log("   → RentCast returns NOTHING for this address.");
        console.log("     RentCast is not an MLS feed (public records + directories), so this");
        console.log("     listing is genuinely absent from their dataset. Not a bug in this app.");
      } else {
        for (const r of rows) {
          console.log(`   → FOUND: ${r.formattedAddress}`);
          console.log(`     status=${r.status} price=${r.price} county=${r.county} listed=${r.listedDate} removed=${r.removedDate ?? "-"}`);
          if (r.status && r.status.toLowerCase() !== "active") {
            console.log(`     ⚠ status is not "Active" — our sync sends status=Active, so it is FILTERED OUT.`);
          }
        }
      }
    }
    console.log("");
  }

  // --- 3. How many listings does RentCast have for the town? ------------
  console.log(`3) RentCast, city=${town} (this is the ground truth for "how many exist")`);
  const activeRows = await call(apiKey, { city: town, state: "NJ", status: "Active", limit: "500" }, "city active");
  if (activeRows) console.log(`   active: ${activeRows.length}${activeRows.length === 500 ? " (hit page limit — more exist)" : ""}`);
  const allRows = await call(apiKey, { city: town, state: "NJ", limit: "500" }, "city all statuses");
  if (allRows) {
    console.log(`   all statuses: ${allRows.length}${allRows.length === 500 ? " (hit page limit — more exist)" : ""}`);
    console.log(`   status breakdown: ${tally(allRows, "status")}`);
    console.log(`   county values RentCast reports: ${tally(allRows, "county")}`);
  }
  console.log("");

  // --- 4. Does our county circle actually reach this town? --------------
  const info = getTownInfo(town);
  const area = info ? getCountySearchArea(info.county) : undefined;
  if (area) {
    console.log(`4) Our ${area.county} search circle (lat ${area.lat}, lng ${area.lng}, radius ${area.radius}mi), first page`);
    const circle = await call(
      apiKey,
      {
        latitude: String(area.lat),
        longitude: String(area.lng),
        radius: String(area.radius),
        status: "Active",
        limit: "500",
        offset: "0",
      },
      "county circle page 1"
    );
    if (circle) {
      const inTown = circle.filter((r) => r.city === town).length;
      console.log(`   page 1 returned ${circle.length} listings; ${inTown} are in ${town}`);
      if (circle.length === 500) {
        console.log(`   → page 1 is full, so ${town} listings may sit on LATER pages.`);
        console.log(`     If a sync was budget-truncated before reaching them, that's the gap.`);
      }
    }
  } else {
    console.log(`4) No search circle configured for "${town}" (not in the curated town list).`);
  }

  const after = await getRentcastUsage();
  console.log(`\nAPI budget after: ${after.used}/${after.budget} this month`);
  console.log("\nHow to read this:");
  console.log("  • (2) empty            → RentCast genuinely lacks the listing. Nothing to fix here.");
  console.log("  • (2) found, non-Active→ our status=Active filter hides it (fixable — ask me to include it).");
  console.log("  • (3) >> (1)           → RentCast has far more than we stored: run a full sync.");
  console.log("  • (3) ≈ (1)            → we already hold everything RentCast offers for this town.");
}

main()
  .catch((e) => {
    console.error("Diagnostic failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
