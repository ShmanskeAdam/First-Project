import { prisma } from "@/lib/db";
import { COUNTIES } from "@/lib/towns";

/**
 * RentCast's free tier allows 50 requests/month. The app self-limits to 45 —
 * metering is exact (one atomic reservation per real request), so the only
 * reason for slack is requests made outside this app (e.g. testing the key in
 * RentCast's own dashboard). 45 leaves room for a comprehensive all-county
 * pull (~20-30 requests) plus daily one-county refreshes in the same month.
 * Override with RENTCAST_MONTHLY_BUDGET (e.g. on a paid RentCast plan).
 */
export function getMonthlyBudget(): number {
  const fromEnv = Number(process.env.RENTCAST_MONTHLY_BUDGET);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 45;
}

function currentMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function getRow() {
  return prisma.appConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
}

/** The stored RentCast key, or null. Never expose this value to the client. */
export async function getStoredRentcastKey(): Promise<string | null> {
  try {
    const row = await getRow();
    return row.rentcastApiKey?.trim() || null;
  } catch {
    // If the DB is unreachable, provider resolution falls back to env config.
    return null;
  }
}

/** Set (or clear, with null/"") the stored RentCast key. */
export async function setStoredRentcastKey(key: string | null): Promise<void> {
  const value = key?.trim() || null;
  await prisma.appConfig.upsert({
    where: { id: "default" },
    create: { id: "default", rentcastApiKey: value },
    update: { rentcastApiKey: value },
  });
}

export interface RentcastUsage {
  used: number;
  budget: number;
  month: string;
}

/** This month's metered RentCast usage (auto-resets the counter on month rollover). */
export async function getRentcastUsage(): Promise<RentcastUsage> {
  const row = await getRow();
  const month = currentMonthKey();
  const used = row.requestMonth === month ? row.requestsThisMonth : 0;
  return { used, budget: getMonthlyBudget(), month };
}

/**
 * Atomically reserve **one** RentCast API request against this month's budget,
 * called immediately before each network request as a sync paginates. Returns
 * `true` if the request is allowed, `false` if it would exceed the budget (the
 * caller then stops paginating).
 *
 * This is the hard "never overrun the free tier" guarantee: the whole
 * check-and-increment is a single conditional `UPDATE`, so Postgres row
 * locking serializes concurrent syncs — of two callers racing at the
 * threshold, at most one can push the counter across it; the other's WHERE
 * clause matches nothing and it reserves nothing. The month-rollover reset is
 * folded into the same statement, so it's atomic too. Because exactly one
 * request is reserved per actual network call, the metered count equals real
 * usage with no estimate/reconcile gap — which is what lets a sync paginate an
 * entire county with no fixed page cap while staying provably under budget.
 */
/**
 * Signature of what a comprehensive pull currently *means*: the query strategy
 * plus the exact county list. Stored alongside `lastFullSyncAt`; when the
 * deployed code's signature differs from what's stored, the existing rows were
 * gathered under different (and, for `county-param-v0`, outright broken —
 * RentCast has no county filter, so those rows are a mis-attributed statewide
 * slice) rules. runSync then re-runs a full pull and drops the stale rows.
 * Bump this whenever a change alters which listings a full sync should yield.
 */
export const SYNC_COVERAGE_VERSION = `radius-v1:${COUNTIES.join(",")}`;

/** True when stored coverage differs from what this build produces (or nothing was ever pulled). */
export async function needsCoverageCatchUp(): Promise<boolean> {
  const row = await getRow();
  return row.lastFullSyncAt === null || row.fullSyncCoverage !== SYNC_COVERAGE_VERSION;
}

/**
 * True when listings are already stored under a *different* coverage signature
 * — i.e. gathered by superseded (possibly incorrect) query rules, so the next
 * full pull should replace them rather than merge into them. A first-ever sync
 * (no stored coverage and no data) is not "stale": there's nothing to discard.
 */
export async function hasStaleCoverageData(): Promise<boolean> {
  const row = await getRow();
  if (row.fullSyncCoverage === SYNC_COVERAGE_VERSION) return false;
  const existing = await prisma.listing.count({ where: { source: { not: "mock" } } });
  return existing > 0;
}

/**
 * Atomically claim the "catch-up" comprehensive pull. Returns true for exactly
 * one caller while the stored coverage is missing or stale (the conditional
 * UPDATE is a single statement, so two same-instant Refresh clicks can't both
 * launch a full pull). This is how an already-deployed site self-heals — after
 * first connect, after a pagination fix, or after the county list / query
 * strategy changes — with no manual step.
 */
export async function claimCatchUpFullSync(): Promise<boolean> {
  await prisma.appConfig.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
  const affected = await prisma.$executeRaw`
    UPDATE "AppConfig"
    SET "lastFullSyncAt" = NOW(), "fullSyncCoverage" = ${SYNC_COVERAGE_VERSION}, "updatedAt" = NOW()
    WHERE "id" = 'default'
      AND ("lastFullSyncAt" IS NULL OR "fullSyncCoverage" IS DISTINCT FROM ${SYNC_COVERAGE_VERSION})
  `;
  return affected > 0;
}

/** Undo a catch-up claim whose run failed, so a later sync retries it. */
export async function resetCatchUpClaim(): Promise<void> {
  await prisma.appConfig
    .update({ where: { id: "default" }, data: { lastFullSyncAt: null, fullSyncCoverage: null } })
    .catch(() => undefined);
}

/** Record that a deliberate full pull (connect flow / sync:full) completed. */
export async function markFullSyncCompleted(): Promise<void> {
  await prisma.appConfig.upsert({
    where: { id: "default" },
    create: { id: "default", lastFullSyncAt: new Date(), fullSyncCoverage: SYNC_COVERAGE_VERSION },
    update: { lastFullSyncAt: new Date(), fullSyncCoverage: SYNC_COVERAGE_VERSION },
  });
}

export async function reserveRentcastRequest(): Promise<boolean> {
  const month = currentMonthKey();
  const budget = getMonthlyBudget();

  // Ensure the singleton row exists so the conditional UPDATE can match it
  // (a missing row would look identical to "over budget": zero rows affected).
  await prisma.appConfig.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });

  const affected = await prisma.$executeRaw`
    UPDATE "AppConfig"
    SET "requestsThisMonth" =
          (CASE WHEN "requestMonth" = ${month} THEN "requestsThisMonth" ELSE 0 END) + 1,
        "requestMonth" = ${month},
        "updatedAt" = NOW()
    WHERE "id" = 'default'
      AND (CASE WHEN "requestMonth" = ${month} THEN "requestsThisMonth" ELSE 0 END) + 1 <= ${budget}
  `;

  return affected > 0;
}
