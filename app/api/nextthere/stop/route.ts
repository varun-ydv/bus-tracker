import { NextRequest, NextResponse } from "next/server";
import { fetchStopInfo } from "@/lib/nextthere";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const stopId = req.nextUrl.searchParams.get("stopId");

  if (!stopId) return NextResponse.json({ error: "stopId required" }, { status: 400 });

  try {
    const data = await fetchStopInfo(stopId);
    return NextResponse.json(data);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
