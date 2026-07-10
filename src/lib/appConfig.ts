import { prisma } from "@/lib/db";

/**
 * RentCast's free tier allows 50 requests/month. The app self-limits to a
 * slightly lower budget so it can never overrun the tier even if a sync's
 * page count comes in higher than estimated. Override with
 * RENTCAST_MONTHLY_BUDGET (e.g. on a paid RentCast plan).
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

/** Record `count` RentCast API requests against this month's budget. */
export async function recordRentcastUsage(count: number): Promise<void> {
  if (count <= 0) return;
  const month = currentMonthKey();
  const row = await getRow();
  const base = row.requestMonth === month ? row.requestsThisMonth : 0;
  await prisma.appConfig.update({
    where: { id: "default" },
    data: { requestsThisMonth: base + count, requestMonth: month },
  });
}

/**
 * Whether a sync expected to cost up to `estimatedRequests` fits in what's
 * left of this month's budget.
 */
export async function hasBudgetFor(estimatedRequests: number): Promise<{ ok: boolean; usage: RentcastUsage }> {
  const usage = await getRentcastUsage();
  return { ok: usage.used + estimatedRequests <= usage.budget, usage };
}
