import { NextRequest, NextResponse } from "next/server";
import { fetchRouteGeometry } from "@/lib/routes";
import {
  getAnytripDepartures,
  getTransitDepartures,
} from "@/lib/timetable";
import type { TimingProvider } from "@/lib/types";
import type { StopDeparturesResult, StopDeparture } from "@/lib/stop-departures";
import { transitConfigured } from "@/lib/transit";
import { ANYTRIP_ROUTE_GROUPS, ANYTRIP_ACT_ROUTE_GROUPS } from "@/lib/routes";

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

function timingProvider(raw: string | null): TimingProvider {
  if (raw && TIMING_PROVIDERS.includes(raw as TimingProvider)) {
    return raw as TimingProvider;
  }
  return "auto";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const stopId = searchParams.get("stopId")?.trim();
  if (!stopId) {
    return NextResponse.json({ error: "missing 'stopId'" }, { status: 400 });
  }

  const routeNumber = searchParams.get("route")?.trim() ?? null;
  if (!routeNumber) {
    return NextResponse.json({ error: "missing 'route'" }, { status: 400 });
  }

  const provider = timingProvider(searchParams.get("provider"));
  const nNext = Math.min(
    Math.max(parseInt(searchParams.get("next") ?? "25", 10) || 25, 1),
    50
  );

  try {
    const geometry = await fetchRouteGeometry(routeNumber);
    const localStop = geometry?.stops.find((s) => s.id === stopId);
    if (!localStop) {
      return NextResponse.json(
        { error: "stop not found on this route" },
        { status: 404 }
      );
    }

    // Try Transit provider
    if (provider === "transit" && transitConfigured()) {
      const result = await getTransitDepartures(routeNumber, localStop, { nNext });
      if (result) {
        const departures: StopDeparture[] = [...result.past, ...result.next]
          .sort((a, b) => a.minutesFromNow - b.minutesFromNow)
          .filter((d) => d.minutesFromNow > -60)
          .map((d) => ({
            tripId: d.tripId,
            routeNumber,
            routeColor: geometry?.color ?? null,
            headsign: d.headsign,
            time: d.time,
            date: d.date,
            minutesFromNow: d.minutesFromNow,
            delaySeconds: d.delaySeconds ?? null,
            live: d.live,
          }));

        return NextResponse.json({
          stopId,
          stopName: localStop.name,
          source: { provider: "transit", label: "Transit" },
          now: result.now,
          departures,
        } satisfies StopDeparturesResult, {
          headers: { "Cache-Control": "no-store" },
        });
      }
    }

    // Try AnyTrip (for ACT and Qcity routes)
    if (
      provider === "auto" ||
      provider === "anytrip" ||
      provider === "canberra"
    ) {
      const anytripGroupId =
        ANYTRIP_ROUTE_GROUPS[routeNumber] ?? ANYTRIP_ACT_ROUTE_GROUPS[routeNumber];
      if (anytripGroupId) {
        const result = await getAnytripDepartures(
          anytripGroupId,
          stopId,
          routeNumber,
          { nPrev: 0, nNext }
        );
        if (result) {
          const departures: StopDeparture[] = result.next.map((d) => ({
            tripId: d.tripId,
            routeNumber,
            routeColor: geometry?.color ?? null,
            headsign: d.headsign,
            time: d.time,
            date: d.date,
            minutesFromNow: d.minutesFromNow,
            delaySeconds: d.delaySeconds ?? null,
            live: d.live,
          }));

          return NextResponse.json({
            stopId,
            stopName: localStop.name,
            source: { provider: "anytrip", label: "AnyTrip" },
            now: result.now,
            departures,
          } satisfies StopDeparturesResult, {
            headers: { "Cache-Control": "no-store" },
          });
        }
      }
    }

    return NextResponse.json(
      { error: "no departures available from this source for this stop" },
      { status: 501 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 502 }
    );
  }
}
