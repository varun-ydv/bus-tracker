import { NextRequest, NextResponse } from "next/server";
import { searchStops, searchRoutes } from "@/lib/nextthere";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const type = req.nextUrl.searchParams.get("type") ?? "stop";
  const limit = Number(req.nextUrl.searchParams.get("limit")) || 20;

  if (!q) return NextResponse.json({ results: [] });

  try {
    const results = type === "route" ? await searchRoutes(q, limit) : await searchStops(q, limit);
    return NextResponse.json({ results });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
