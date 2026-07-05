import { NextResponse } from "next/server";
import { TOWNS, COUNTIES } from "@/lib/towns";

export async function GET() {
  return NextResponse.json({ towns: TOWNS, counties: COUNTIES });
}
