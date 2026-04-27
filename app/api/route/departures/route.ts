import { NextRequest, NextResponse } from "next/server";
import {
  getDepartures,
  getAnytripDepartures,
  getTransitDepartures,
  routeStops,
  type Departure,
  type DeparturesResult,
} from "@/lib/timetable";
import {
  fetchRouteGeometry,
  canonicalRouteNumber,
  ANYTRIP_ROUTE_GROUPS,
  resolveAnytripRouteGroupId,
  enrichStopNamesFromAnytrip,
} from "@/lib/routes";
import type { TimingProvider } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TIMING_PROVIDERS = [
  "auto",
  "canberra",
  "nsw",
  "anytrip",
  "nextthere",
  "transit",
] as const satisfies readonly TimingProvider[];

const PROVIDER_LABEL: Record<TimingProvider, string> = {
  auto: "Auto",
  canberra: "Transport Canberra",
  nsw: "Transport NSW",
  anytrip: "AnyTrip",
  nextthere: "NextThere",
  transit: "Transit",
};

function timingProvider(raw: string | null): TimingProvider {
  if (raw && TIMING_PROVIDERS.includes(raw as TimingProvider)) {
    return raw as TimingProvider;
  }
  return "auto";
}

/**
 * GET /api/route/departures?number=830&stopId=au2:2620310&provider=transit
 *   → { number, stopId, stopName,
 *       stops: [{id, name, count}],
 *       source: { provider, label },
 *       now: { hhmm, yyyymmdd, tz },
 *       past: Departure[],
 *       next: Departure[],
 *     }
 *
 * Dispatches based on `provider` param:
 *   "transit"    → Transit App API (global, live departures)
 *   "anytrip"    → AnyTrip departures (any route, dynamic route-group lookup)
 *   "canberra"   → ACT GTFS static timetable
 *   "auto"       → best available source for the route
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawNumber = searchParams.get("number")?.trim();
  if (!rawNumber) {
    return NextResponse.json({ error: "missing 'number'" }, { status: 400 });
  }
  const number = canonicalRouteNumber(rawNumber);
  const provider = timingProvider(searchParams.get("provider"));
  const hardcodedGroupId = ANYTRIP_ROUTE_GROUPS[number];

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

  // ─── Transit path ──────────────────────────────────────────────────
  // Transit resolves stops by lat/lon, not by GTFS stop IDs. We use the
  // route geometry to find the user's chosen stop and pass its coords.
  if (provider === "transit") {
    const stops = (geom?.stops ?? []).map((s, i) => ({
      id: s.id,
      name: s.name,
      count: (geom?.stops.length ?? 0) - i,
    }));
    const stopId = searchParams.get("stopId")?.trim() || stops[0]?.id;
    const localStop = (geom?.stops ?? []).find((s) => s.id === stopId);
    if (!stopId || !localStop) {
      return NextResponse.json(
        { error: "no stops available for Transit lookup" },
        { status: 501 }
      );
    }

    try {
      const result = await getTransitDepartures(number, localStop, {
        nNext,
        nPrev,
      });
      if (!result) {
        return NextResponse.json(
          { error: "no Transit timetable available for this stop" },
          { status: 501 }
        );
      }
      return NextResponse.json(
        packageResult(result, stops, stopName, stopId, null, false, "transit"),
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 502 }
      );
    }
  }

  if (provider === "nsw" || provider === "nextthere") {
    return NextResponse.json(
      {
        error: `${PROVIDER_LABEL[provider]} timing support is not available for this route view yet`,
      },
      { status: 501 }
    );
  }

  // ─── AnyTrip path (hardcoded Qcity routes with AnyTrip-sourced geometry) ──
  if (
    (provider === "auto" || provider === "anytrip") &&
    hardcodedGroupId &&
    geom?.source === "anytrip"
  ) {
    const stops = (geom.stops ?? []).map((s, i) => ({
      id: s.id,
      name: s.name,
      count: geom.stops.length - i,
    }));
    const stopId = searchParams.get("stopId")?.trim() || stops[0]?.id;
    if (!stopId) {
      return NextResponse.json({ error: "no stops for route" }, { status: 500 });
    }
    try {
      const result = await getAnytripDepartures(
        hardcodedGroupId,
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
      return NextResponse.json(
        packageResult(result, stops, stopName, stopId, null, false, "anytrip"),
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 502 }
      );
    }
  }

  // ─── AnyTrip path (ACT routes — dynamic route-group discovery) ────────
  // When the user explicitly selects "anytrip" for a non-hardcoded route
  // (e.g. ACT route 2, 3, 6), we attempt to resolve the route group ID
  // via AnyTrip's search API. If found, we try the departures endpoint.
  // We also enrich stop names from AnyTrip's stop metadata for richer
  // display (e.g. "Westfield Belconnen, Platform 2, Set Down Only").
  if (provider === "anytrip") {
    // Use ACT static timetable for the stop list (since AnyTrip may not have ACT route stops)
    const rawStops = routeStops(number);
    if (!rawStops) {
      return NextResponse.json(
        { error: "no timetable available for this route" },
        { status: 501 }
      );
    }

    const stopId = searchParams.get("stopId")?.trim() || rawStops[0]?.id;
    if (!stopId) {
      return NextResponse.json(
        { error: "no stops for this route" },
        { status: 500 }
      );
    }

    // Enrich stop names from AnyTrip in parallel with route group resolution
    const [resolvedGroupId, enrichedNames] = await Promise.all([
      resolveAnytripRouteGroupId(number),
      enrichStopNamesFromAnytrip(rawStops.map((s) => s.id)),
    ]);

    // Merge enriched names into the base stop name map
    for (const [id, name] of enrichedNames) stopName.set(id, name);

    const stops = rawStops.map((s) => ({
      id: s.id,
      name: stopName.get(s.id) ?? s.id,
      count: s.count,
    }));

    // If we found a route group ID, try to get live departures from AnyTrip
    if (resolvedGroupId) {
      try {
        const atStopId = stopId.includes(":") ? stopId : `au2:${stopId}`;
        const result = await getAnytripDepartures(
          resolvedGroupId,
          atStopId,
          number,
          { nNext, nPrev }
        );
        if (result && (result.next.length > 0 || result.past.length > 0)) {
          return NextResponse.json(
            packageResult(result, stops, stopName, stopId, null, false, "anytrip"),
            { headers: { "Cache-Control": "no-store" } }
          );
        }
      } catch {
        // AnyTrip didn't have departures for this route — fall through to ACT static
      }
    }

    // Fall back to ACT static timetable but still use enriched stop names
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
      packageResult(result, stops, stopName, stopId, toStopId, true, "canberra"),
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // ─── ACT static path ────────────────────────────────────────────────
  if (provider !== "auto" && provider !== "canberra") {
    return NextResponse.json(
      { error: `${PROVIDER_LABEL[provider]} timings are not available for this route` },
      { status: 501 }
    );
  }

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
    packageResult(result, stops, stopName, stopId, toStopId, true, "canberra"),
    { headers: { "Cache-Control": "no-store" } }
  );
}

function packageResult(
  result: DeparturesResult,
  stops: { id: string; name: string; count: number }[],
  stopName: Map<string, string>,
  stopId: string,
  toStopId: string | null,
  supportsTo: boolean,
  provider: TimingProvider
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
    source: {
      provider,
      label: PROVIDER_LABEL[provider],
    },
    stops,
    now: result.now,
    past: result.past.map(enrichTerminus),
    next: result.next.map(enrichTerminus),
  };
}
