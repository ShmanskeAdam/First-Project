import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { FilterPreset } from "@/types/listing";

export async function GET() {
  const rows = await prisma.filterPreset.findMany({ orderBy: { createdAt: "desc" } });
  const presets: FilterPreset[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    filters: JSON.parse(r.filters),
    createdAt: r.createdAt.toISOString(),
  }));
  return NextResponse.json({ presets });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body?.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const row = await prisma.filterPreset.create({
    data: { name: body.name, filters: JSON.stringify(body.filters ?? {}) },
  });
  return NextResponse.json({
    preset: { id: row.id, name: row.name, filters: JSON.parse(row.filters), createdAt: row.createdAt.toISOString() },
  });
}
