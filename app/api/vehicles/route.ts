import { NextRequest, NextResponse } from "next/server";
import { canberraConfigured, fetchCanberraVehicles } from "@/lib/canberra";
import { nswConfigured, fetchNswVehicles } from "@/lib/nsw";
import { anytripConfigured, fetchAnytripVehicles } from "@/lib/anytrip";
import { nextthereConfigured, fetchNextthereVehicles } from "@/lib/nextthere";
import { transitConfigured, fetchTransitVehicles } from "@/lib/transit";
import { distanceMeters } from "@/lib/gtfs";
import {
  findPlace,
  resolveRoutes,
  vehicleMatchesAny,
  vehicleServesPlace,
} from "@/lib/favourites";
import type { Provider, Vehicle, VehiclesResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const routeFilter = searchParams.get("route")?.toLowerCase().trim() ?? null;
  const routesCsv = searchParams.get("routes")?.trim() ?? null;
  const providerFilter = searchParams.get("provider") as Provider | null;
  const placeId = searchParams.get("place");
  const place = findPlace(placeId);
  // Legacy: allow ad-hoc ?lat=&lon=&radius= for custom GPS searches. Places
  // themselves no longer use GPS radius — they match by served-routes.
  const nearLat = Number(searchParams.get("lat"));
  const nearLon = Number(searchParams.get("lon"));
  const radiusMeters = Number(searchParams.get("radius")) || 0;

  const response: VehiclesResponse = {
    vehicles: [],
    providers: {
      canberra: { ok: false, count: 0, configured: canberraConfigured() },
      nsw: { ok: false, count: 0, configured: nswConfigured() },
      anytrip: { ok: false, count: 0, configured: anytripConfigured() },
      nextthere: { ok: false, count: 0, configured: nextthereConfigured() },
      transit: { ok: false, count: 0, configured: transitConfigured() },
    },
    fetchedAt: Date.now(),
  };

  const tasks: Array<Promise<void>> = [];

  if (!providerFilter || providerFilter === "canberra") {
    if (canberraConfigured()) {
      tasks.push(
        fetchCanberraVehicles()
          .then((v) => {
            response.vehicles.push(...v);
            response.providers.canberra.ok = true;
            response.providers.canberra.count = v.length;
          })
          .catch((e: Error) => {
            response.providers.canberra.error = e.message;
          })
      );
    }
  }

  if (!providerFilter || providerFilter === "nsw") {
    if (nswConfigured()) {
      tasks.push(
        fetchNswVehicles()
          .then((v) => {
            response.vehicles.push(...v);
            response.providers.nsw.ok = true;
            response.providers.nsw.count = v.length;
          })
          .catch((e: Error) => {
            response.providers.nsw.error = e.message;
          })
      );
    }
  }

  if (!providerFilter || providerFilter === "anytrip") {
    tasks.push(
      fetchAnytripVehicles()
        .then((v) => {
          response.vehicles.push(...v);
          response.providers.anytrip.ok = true;
          response.providers.anytrip.count = v.length;
        })
        .catch((e: Error) => {
          response.providers.anytrip.error = e.message;
        })
    );
  }

  if (!providerFilter || providerFilter === "nextthere") {
    tasks.push(
      fetchNextthereVehicles()
        .then((v) => {
          response.vehicles.push(...v);
          response.providers.nextthere.ok = true;
          response.providers.nextthere.count = v.length;
        })
        .catch((e: Error) => {
          response.providers.nextthere.error = e.message;
        })
    );
  }

  if (!providerFilter || providerFilter === "transit") {
    if (transitConfigured()) {
      tasks.push(
        fetchTransitVehicles()
          .then((v) => {
            response.vehicles.push(...v);
            response.providers.transit.ok = true;
            response.providers.transit.count = v.length;
          })
          .catch((e: Error) => {
            response.providers.transit.error = e.message;
          })
      );
    }
  }

  await Promise.all(tasks);

  // De-duplicate: multiple providers may surface the same physical bus.
  // Higher priority wins when the same fleet vehicle appears in both.
  // Skip dedup when a specific provider is requested — show raw per-provider data.
  let filtered: Vehicle[];
  if (providerFilter) {
    filtered = response.vehicles;
  } else {
    const byKey = new Map<string, Vehicle>();
    const priority: Record<Vehicle["provider"], number> = {
      anytrip: 5,
      nextthere: 4,
      transit: 3,
      canberra: 2,
      nsw: 1,
    };
    for (const v of response.vehicles) {
      if (!v.label) {
        byKey.set(`${v.provider}:${v.id}`, v);
        continue;
      }
      const key = `vid:${v.label}`;
      const existing = byKey.get(key);
      if (!existing || priority[v.provider] > priority[existing.provider]) {
        byKey.set(key, v);
      }
    }
    filtered = Array.from(byKey.values());
  }

  // A place filter (when set) replaces the route filter: selecting a place
  // means "everything that has to do with this interchange" — routes that
  // serve it, buses heading there, and buses physically near it.
  if (place) {
    filtered = filtered.filter((v) => vehicleServesPlace(v, place));
  } else if (routesCsv) {
    const numbers = routesCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const favourites = resolveRoutes(numbers);
    filtered = filtered.filter((v) => vehicleMatchesAny(v, favourites));
  } else if (routeFilter) {
    const isShortNumeric = /^[0-9a-z]{1,5}$/.test(routeFilter);
    filtered = filtered.filter((v) => {
      const short = v.routeShortName?.toLowerCase() ?? null;
      const route = v.routeId?.toLowerCase() ?? null;
      if (isShortNumeric) {
        if (short === routeFilter) return true;
        if (route === routeFilter) return true;
        if (route && route.endsWith(`_${routeFilter}`)) return true;
        if (route && route.endsWith(`:${routeFilter}`)) return true;
        return false;
      }
      return (
        short?.includes(routeFilter) ||
        route?.includes(routeFilter) ||
        v.headsign?.toLowerCase().includes(routeFilter) ||
        v.label?.toLowerCase().includes(routeFilter)
      );
    });
  }

  // Legacy ad-hoc GPS filter (?lat=&lon=&radius=) still supported.
  if (radiusMeters > 0 && Number.isFinite(nearLat) && Number.isFinite(nearLon)) {
    filtered = filtered.filter(
      (v) => distanceMeters(nearLat, nearLon, v.lat, v.lon) <= radiusMeters
    );
  }

  response.vehicles = filtered;

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
