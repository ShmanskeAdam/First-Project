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
