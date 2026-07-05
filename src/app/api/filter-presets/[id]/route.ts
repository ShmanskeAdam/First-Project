import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.filterPreset.delete({ where: { id: params.id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
