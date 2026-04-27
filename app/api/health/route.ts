import { NextResponse } from "next/server";
import { canberraConfigured } from "@/lib/canberra";
import { nswConfigured } from "@/lib/nsw";
import { transitConfigured } from "@/lib/transit";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    providers: {
      canberra: { configured: canberraConfigured() },
      nsw: { configured: nswConfigured() },
      transit: { configured: transitConfigured() },
    },
    timestamp: Date.now(),
  });
}
