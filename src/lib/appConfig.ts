import { prisma } from "@/lib/db";

/**
 * RentCast's free tier allows 50 requests/month. The app self-limits to a
 * lower budget (40) so that even a full month of daily 2-request syncs
 * (~38 requests) plus a bit of slack stays clear of the cap with margin.
 * Override with RENTCAST_MONTHLY_BUDGET (e.g. on a paid RentCast plan).
 */
export function getMonthlyBudget(): number {
  const fromEnv = Number(process.env.RENTCAST_MONTHLY_BUDGET);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 40;
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
 * Atomically reserve `estimate` requests against this month's budget *before*
 * any API call is made. This is the hard guarantee that monthly usage can
 * never exceed the budget: the whole check-and-increment is a single
 * conditional `UPDATE`, so Postgres row locking serializes concurrent syncs —
 * of two callers racing at the threshold, at most one can push the counter
 * across it; the other's WHERE clause fails and it reserves nothing. The
 * month-rollover reset is folded into the same statement so it's atomic too.
 *
 * Returns `ok: false` (reserving nothing) when the reservation would exceed
 * budget. The reserved amount is a worst-case estimate; call
 * `reconcileRentcastUsage` afterwards to settle it against the real count.
 */
export async function reserveRentcastRequests(estimate: number): Promise<{ ok: boolean; usage: RentcastUsage }> {
  const month = currentMonthKey();
  const budget = getMonthlyBudget();

  // Ensure the singleton row exists so the conditional UPDATE can match it
  // (a missing row would look identical to "over budget": zero rows affected).
  await prisma.appConfig.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });

  const affected = await prisma.$executeRaw`
    UPDATE "AppConfig"
    SET "requestsThisMonth" =
          (CASE WHEN "requestMonth" = ${month} THEN "requestsThisMonth" ELSE 0 END) + ${estimate},
        "requestMonth" = ${month},
        "updatedAt" = NOW()
    WHERE "id" = 'default'
      AND (CASE WHEN "requestMonth" = ${month} THEN "requestsThisMonth" ELSE 0 END) + ${estimate} <= ${budget}
  `;

  const usage = await getRentcastUsage();
  return { ok: affected > 0, usage };
}

/**
 * Settle a prior `reserveRentcastRequests(reserved)` against the `actual`
 * number of API requests the sync really made (usually fewer, since the
 * reserved figure is a worst-case estimate — and fewer still if the fetch
 * failed partway). Adjusts the counter by `actual - reserved`, clamped at 0.
 * The `requestMonth` guard means a rollover between reserve and reconcile
 * simply leaves the estimate counted in the old month (conservative — it can
 * only ever over-count, never under-count).
 */
export async function reconcileRentcastUsage(reserved: number, actual: number): Promise<void> {
  const delta = actual - reserved;
  if (delta === 0) return;
  const month = currentMonthKey();
  await prisma.$executeRaw`
    UPDATE "AppConfig"
    SET "requestsThisMonth" = GREATEST(0, "requestsThisMonth" + ${delta}),
        "updatedAt" = NOW()
    WHERE "id" = 'default' AND "requestMonth" = ${month}
  `;
}
