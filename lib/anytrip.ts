import type { Vehicle } from "./types";

/**
 * AnyTrip is a free public transit tracker covering Australia.
 * Their `/vehicles` endpoint exposes the consolidated realtime feed they
 * already aggregate from operators that don't publish a usable public
 * GTFS-RT feed (notably Qcity Transit / route 830 in Queanbeyan).
 *
 * This is the same data their own web app at https://anytrip.com.au uses.
 * No auth required, but be polite: we cache responses for a short TTL
 * so a refreshing client UI doesn't hammer their API.
 */

const ANYTRIP_NSW_ENDPOINT =
  process.env.ANYTRIP_NSW_ENDPOINT ??
  "https://api-cf-oc2.anytrip.com.au/api/v3/region/au2/vehicles";

const ANYTRIP_USER_AGENT =
  process.env.ANYTRIP_USER_AGENT ??
  "Bus-tracker/1.0 (personal use; +https://github.com/)";

interface ATCoord { lat: number; lon: number }
interface ATPosition {
  time?: number;
  bearing?: number;
  speed?: number;
  status?: number;
  statusString?: string;
  vehicleOccupancy?: number;
  occupancy?: number[];
  coordinates?: ATCoord;
}
interface ATAgency { id: string; name: string }
interface ATRoute {
  id: string;
  name: string;
  longName?: string;
  routeGroupId?: string;
  mode?: string;
  color?: string;
  agency?: ATAgency;
}
interface ATTrip {
  id: string;
  rtTripId?: string;
  headsign?: { headline?: string };
  route?: ATRoute;
}
interface ATTripInstance { trip?: ATTrip }
interface ATVehicleInstance {
  id?: string;
  reportedTripId?: string;
  lastPosition?: ATPosition;
}
interface ATVehicle {
  tripInstance?: ATTripInstance;
  vehicleInstance?: ATVehicleInstance;
}
interface ATResponse {
  response: { vehicles: ATVehicle[] };
}

const OCCUPANCY_NAMES: Record<number, string> = {
  0: "EMPTY",
  1: "MANY_SEATS_AVAILABLE",
  2: "FEW_SEATS_AVAILABLE",
  3: "STANDING_ROOM_ONLY",
  4: "CRUSHED_STANDING_ROOM_ONLY",
  5: "FULL",
  6: "NOT_ACCEPTING_PASSENGERS",
};

let cache: { data: Vehicle[]; at: number } | null = null;
const CACHE_TTL_MS = 10_000;

export function anytripConfigured(): boolean {
  return true;
}

export async function fetchAnytripVehicles(): Promise<Vehicle[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const res = await fetch(ANYTRIP_NSW_ENDPOINT, {
    headers: { "User-Agent": ANYTRIP_USER_AGENT, Accept: "application/json" },
    cache: "no-store",
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`anytrip HTTP ${res.status}: ${res.statusText}`);
  }
  const json = (await res.json()) as ATResponse;

  const vehicles: Vehicle[] = [];
  for (const v of json.response?.vehicles ?? []) {
    const trip = v.tripInstance?.trip;
    const route = trip?.route;
    if (!route) continue;
    if (route.mode && !route.mode.endsWith(":buses")) continue;

    const pos = v.vehicleInstance?.lastPosition;
    const coord = pos?.coordinates;
    if (!coord || typeof coord.lat !== "number" || typeof coord.lon !== "number") {
      continue;
    }

    const vid = v.vehicleInstance?.id ?? trip?.id ?? "";
    const occCode = pos?.vehicleOccupancy ?? pos?.occupancy?.[0];

    vehicles.push({
      id: `at:${vid}`,
      provider: "anytrip",
      routeId: route.name ?? null,
      routeShortName: route.name ?? null,
      tripId: trip?.rtTripId ?? trip?.id ?? null,
      label: v.vehicleInstance?.id ?? null,
      lat: coord.lat,
      lon: coord.lon,
      bearing: typeof pos?.bearing === "number" ? pos.bearing : null,
      speed: typeof pos?.speed === "number" ? pos.speed : null,
      timestamp: typeof pos?.time === "number" ? pos.time : Math.floor(Date.now() / 1000),
      occupancy: occCode != null ? OCCUPANCY_NAMES[occCode] ?? null : null,
      currentStopSequence: null,
      currentStatus: null,
      agency: route.agency?.name ?? null,
      headsign: trip?.headsign?.headline ?? null,
      statusString: pos?.statusString ?? null,
      routeColor: route.color ? `#${route.color}` : null,
    });
  }

  cache = { data: vehicles, at: Date.now() };
  return vehicles;
}
