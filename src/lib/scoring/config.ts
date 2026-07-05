import { prisma } from "@/lib/db";
import type { ScoringConfig } from "@/types/listing";

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  pricePerSqftWeight: 0.4,
  priceCutWeight: 0.3,
  domWeight: 0.1,
  compSalesWeight: 0.2,
  priceCutRecencyDays: 30,
  compSaleLookbackMonths: 12,
};

export async function getScoringConfig(): Promise<ScoringConfig> {
  const row = await prisma.scoringConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
  return {
    pricePerSqftWeight: row.pricePerSqftWeight,
    priceCutWeight: row.priceCutWeight,
    domWeight: row.domWeight,
    compSalesWeight: row.compSalesWeight,
    priceCutRecencyDays: row.priceCutRecencyDays,
    compSaleLookbackMonths: row.compSaleLookbackMonths,
  };
}

export async function updateScoringConfig(patch: Partial<ScoringConfig>): Promise<ScoringConfig> {
  const row = await prisma.scoringConfig.upsert({
    where: { id: "default" },
    create: { id: "default", ...patch },
    update: patch,
  });
  return {
    pricePerSqftWeight: row.pricePerSqftWeight,
    priceCutWeight: row.priceCutWeight,
    domWeight: row.domWeight,
    compSalesWeight: row.compSalesWeight,
    priceCutRecencyDays: row.priceCutRecencyDays,
    compSaleLookbackMonths: row.compSaleLookbackMonths,
  };
}
