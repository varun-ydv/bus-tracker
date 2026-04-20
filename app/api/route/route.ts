import { NextRequest, NextResponse } from "next/server";
import { fetchRouteGeometry } from "@/lib/routes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/route?number=830
 *  → { number, color, agency, shapes: [{points: [[lat,lon], ...]}], stops: [...] }
 *
 * Used by the map to draw the highlighted line + stop dots when the user has
 * drilled into a single route.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const number = searchParams.get("number")?.trim();
  if (!number) {
    return NextResponse.json(
      { error: "missing 'number' query param" },
      { status: 400 }
    );
  }

  try {
    const geometry = await fetchRouteGeometry(number);
    if (!geometry) {
      return NextResponse.json(
        { error: `no route data for ${number}` },
        { status: 404 }
      );
    }
    return NextResponse.json(geometry, {
      headers: {
        // Shape data barely changes — let the browser cache it for 10 min.
        "Cache-Control": "public, max-age=600, stale-while-revalidate=86400",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502 }
    );
  }
}
