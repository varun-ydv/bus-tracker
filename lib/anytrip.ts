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

const ANYTRIP_ACT_ENDPOINT =
  process.env.ANYTRIP_ACT_ENDPOINT ??
  "https://api-cf-au9.anytrip.com.au/api/v3/region/au9/vehicles";

const ANYTRIP_USER_AGENT =
  process.env.ANYTRIP_USER_AGENT ??
  "Bus-tracker/1.0 (personal use; +https://github.com/)";

interface ATCoord { lat: number; lon: number }
interface ATStopTimeEvent {
  time?: number;
  delay?: number;
  occupancy?: number[];
  vehicleOccupancy?: number;
}
interface ATSurroundingStop {
  stop?: { id: string; name?: unknown; code?: string };
  arrival?: ATStopTimeEvent;
  departure?: ATStopTimeEvent;
}
interface ATPosition {
  time?: number;
  bearing?: number;
  speed?: number;
  status?: number;
  statusString?: string;
  vehicleOccupancy?: number;
  occupancy?: number[];
  coordinates?: ATCoord;
  distance?: number;
  linearDelay?: number;
  surroundingStops?: { prev?: ATSurroundingStop; next?: ATSurroundingStop };
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
const CACHE_TTL_MS = 5_000;

export function anytripConfigured(): boolean {
  return true;
}

export async function fetchAnytripVehicles(): Promise<Vehicle[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const vehicles: Vehicle[] = [];
  const parseVehicles = (json: ATResponse) => {
    for (const v of json.response?.vehicles ?? []) {
      const trip = v.tripInstance?.trip;
      const route = trip?.route;
      if (!route) continue;
      if (route.mode && !route.mode.endsWith(":buses") && !route.mode.endsWith(":lightrail")) continue;

      const pos = v.vehicleInstance?.lastPosition;
      const coord = pos?.coordinates;
      if (!coord || typeof coord.lat !== "number" || typeof coord.lon !== "number") {
        continue;
      }

      const vid = v.vehicleInstance?.id ?? trip?.id ?? "";
      const occCode = pos?.vehicleOccupancy ?? pos?.occupancy?.[0];
      const ss = pos?.surroundingStops;
      const delay =
        pos?.linearDelay ??
        ss?.next?.departure?.delay ??
        ss?.prev?.departure?.delay ??
        null;

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
        delay,
      });
    }
  };

  const headers = { "User-Agent": ANYTRIP_USER_AGENT, Accept: "application/json" };
  const [nswRes, actRes] = await Promise.allSettled([
    fetch(ANYTRIP_NSW_ENDPOINT, { headers, cache: "no-store", next: { revalidate: 0 } }),
    fetch(ANYTRIP_ACT_ENDPOINT, { headers, cache: "no-store", next: { revalidate: 0 } }),
  ]);

  if (nswRes.status === "fulfilled" && nswRes.value.ok) {
    parseVehicles((await nswRes.value.json()) as ATResponse);
  }
  if (actRes.status === "fulfilled" && actRes.value.ok) {
    parseVehicles((await actRes.value.json()) as ATResponse);
  }

  cache = { data: vehicles, at: Date.now() };
  return vehicles;
}
