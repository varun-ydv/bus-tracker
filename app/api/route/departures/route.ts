import { NextRequest, NextResponse } from "next/server";
import {
  getDepartures,
  getAnytripDepartures,
  routeStops,
  type Departure,
  type DeparturesResult,
} from "@/lib/timetable";
import {
  fetchRouteGeometry,
  canonicalRouteNumber,
  ANYTRIP_ROUTE_GROUPS,
} from "@/lib/routes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/route/departures?number=830&stopId=au2:2620310
 *   → { number, stopId, stopName,
 *       stops: [{id, name, count}],   // all stops on this route
 *       now: { hhmm, yyyymmdd, tz },
 *       past: Departure[],   // last 3 that already went
 *       next: Departure[],   // next 5 coming up
 *     }
 *
 * Dispatches to the ACT static timetable for Canberra routes, and to
 * AnyTrip's /departures endpoint for Qcity routes (which also includes
 * live delay data).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawNumber = searchParams.get("number")?.trim();
  if (!rawNumber) {
    return NextResponse.json({ error: "missing 'number'" }, { status: 400 });
  }
  const number = canonicalRouteNumber(rawNumber);
  const anytripRouteGroupId = ANYTRIP_ROUTE_GROUPS[number];

  // Shape + stops catalogue powers both the picker and the name lookups.
  const geom = await fetchRouteGeometry(number);
  const stopName = new Map<string, string>();
  for (const s of geom?.stops ?? []) stopName.set(s.id, s.name);

  const nNext = Math.min(
    Math.max(parseInt(searchParams.get("next") ?? "6", 10) || 6, 1),
    20
  );
  const nPrev = Math.min(
    Math.max(parseInt(searchParams.get("prev") ?? "3", 10) || 3, 0),
    20
  );

  const toStopId = searchParams.get("toStopId")?.trim() || null;

  // ─── AnyTrip path (Qcity 830/831/…) ──────────────────────────────────
  if (anytripRouteGroupId && geom?.source === "anytrip") {
    // We have a stops list from /routeGroup/X/stops (in geom.stops).
    // Order the picker by visit count heuristic using position along route.
    const stops = (geom.stops ?? []).map((s, i) => ({
      id: s.id,
      name: s.name,
      count: geom.stops.length - i, // pseudo count: origin first
    }));
    const stopId = searchParams.get("stopId")?.trim() || stops[0]?.id;
    if (!stopId) {
      return NextResponse.json({ error: "no stops for route" }, { status: 500 });
    }
    try {
      const result = await getAnytripDepartures(
        anytripRouteGroupId,
        stopId,
        number,
        { nNext, nPrev }
      );
      if (!result) {
        return NextResponse.json(
          { error: "no timetable available" },
          { status: 501 }
        );
      }
      // AnyTrip departures are stop-keyed; we can't cheaply derive arrival
      // times at a second stop, so the "To" picker is disabled for Qcity.
      return NextResponse.json(
        packageResult(result, stops, stopName, stopId, null, false),
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 502 }
      );
    }
  }

  // ─── ACT static path ────────────────────────────────────────────────
  const rawStops = routeStops(number);
  if (!rawStops) {
    return NextResponse.json(
      { error: "no timetable available for this route" },
      { status: 501 }
    );
  }

  const stops = rawStops.map((s) => ({
    id: s.id,
    name: stopName.get(s.id) ?? s.id,
    count: s.count,
  }));

  const stopId = searchParams.get("stopId")?.trim() || stops[0]?.id;
  if (!stopId) {
    return NextResponse.json(
      { error: "no stops for this route" },
      { status: 500 }
    );
  }

  const result = getDepartures(number, stopId, {
    nNext,
    nPrev,
    toStopId,
  });
  if (!result) {
    return NextResponse.json(
      { error: "no timetable for route " + number },
      { status: 501 }
    );
  }

  return NextResponse.json(
    packageResult(result, stops, stopName, stopId, toStopId, true),
    { headers: { "Cache-Control": "no-store" } }
  );
}

function packageResult(
  result: DeparturesResult,
  stops: { id: string; name: string; count: number }[],
  stopName: Map<string, string>,
  stopId: string,
  toStopId: string | null,
  supportsTo: boolean
) {
  const enrichTerminus = (d: Departure) => ({
    ...d,
    terminusName: d.terminus ? stopName.get(d.terminus) ?? d.terminus : null,
  });
  return {
    number: result.number,
    stopId,
    stopName: stopName.get(stopId) ?? stopId,
    toStopId: toStopId ?? null,
    toStopName: toStopId ? stopName.get(toStopId) ?? toStopId : null,
    supportsTo,
    stops,
    now: result.now,
    past: result.past.map(enrichTerminus),
    next: result.next.map(enrichTerminus),
  };
}
