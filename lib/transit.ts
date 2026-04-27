import type { Vehicle } from "./types";

/**
 * Transit App API v3 client — https://api-doc.transitapp.com/
 *
 * Provides global transit data: nearby routes with live departure times,
 * nearby stops, and real-time vehicle positions embedded in schedule_items.
 *
 * Auth: `apiKey` header.
 * Quota: 1,500 calls/month, 5 calls/min on the free tier.
 * We use aggressive server-side caching (5 min TTL) to stay within budget.
 */

const TRANSIT_API_BASE = "https://external.transitapp.com/v3/public";
const TRANSIT_API_KEY = process.env.TRANSIT_API_KEY ?? "";

const CACHE_TTL_MS = 5 * 60 * 1000;

// ────────────────────────────────────────────────────────────────────────────
// Raw Transit API response types
// ────────────────────────────────────────────────────────────────────────────

interface TransitScheduleItem {
  departure_time: number;
  is_cancelled: boolean;
  is_real_time: boolean;
  rt_trip_id?: string;
  scheduled_departure_time: number;
  trip_search_key?: string;
  wheelchair_accessible?: number;
}

interface TransitStop {
  global_stop_id: string;
  location_type: number;
  parent_station_global_stop_id?: string | null;
  route_type: number;
  rt_stop_id?: string;
  stop_code?: string;
  stop_lat: number;
  stop_lon: number;
  stop_name: string;
  wheelchair_boarding?: number;
}

interface TransitItinerary {
  branch_code?: string;
  closest_stop: TransitStop;
  direction_headsign?: string;
  direction_id: number;
  headsign?: string;
  merged_headsign?: string;
  schedule_items: TransitScheduleItem[];
}

interface TransitRoute {
  global_route_id: string;
  itineraries: TransitItinerary[];
  mode_name?: string;
  real_time_route_id?: string;
  route_color?: string;
  route_long_name?: string;
  route_short_name?: string;
  route_text_color?: string;
  route_type: number;
  route_display_short_name?: {
    elements: (string | null)[];
  };
  fares?: Array<{
    fare_media_type: number;
    price_min?: {
      currency_code: string;
      symbol: string;
      text: string;
      value: number;
    };
  }>;
}

interface TransitNearbyRoutesResponse {
  routes: TransitRoute[];
}

interface TransitNearbyStop {
  distance: number;
  global_stop_id: string;
  location_type: number;
  parent_station_global_stop_id?: string | null;
  parent_station?: {
    global_stop_id: string;
    station_code?: string;
    station_name?: string;
  };
  route_type: number;
  stop_lat: number;
  stop_lon: number;
  stop_name: string;
  stop_code?: string;
  rt_stop_id?: string;
  wheelchair_boarding?: number;
}

interface TransitNearbyStopsResponse {
  stops: TransitNearbyStop[];
}

// ────────────────────────────────────────────────────────────────────────────
// Cache layer
// ────────────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  at: number;
  key: string;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, at: Date.now(), key });
}

// ────────────────────────────────────────────────────────────────────────────
// HTTP helper
// ────────────────────────────────────────────────────────────────────────────

async function transitFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${TRANSIT_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const cacheKey = url.toString();
  const cached = getCached<T>(cacheKey);
  if (cached) return cached;

  const res = await fetch(url.toString(), {
    headers: {
      apiKey: TRANSIT_API_KEY,
      Accept: "application/json",
    },
    cache: "no-store",
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(`Transit API ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`);
  }

  const data = (await res.json()) as T;
  setCache(cacheKey, data);
  return data;
}

// ────────────────────────────────────────────────────────────────────────────
// Configuration check
// ────────────────────────────────────────────────────────────────────────────

export function transitConfigured(): boolean {
  return Boolean(TRANSIT_API_KEY);
}

// ────────────────────────────────────────────────────────────────────────────
// Map Transit data → Vehicle type
// ────────────────────────────────────────────────────────────────────────────

/**
 * The Transit API doesn't have a dedicated "vehicle positions" endpoint like
 * GTFS-RT. Instead, live vehicle info is embedded in schedule_items within
 * nearby_routes: each schedule_item with is_real_time=true represents a live
 * vehicle. We synthesize a Vehicle from the closest stop position + the
 * departure time.
 */
function routeToVehicles(route: TransitRoute): Vehicle[] {
  const vehicles: Vehicle[] = [];
  const shortName = route.route_short_name ?? route.real_time_route_id ?? null;
  const routeColor = route.route_color ? `#${route.route_color}` : null;

  for (const itin of route.itineraries) {
    for (const si of itin.schedule_items) {
      if (!si.is_real_time) continue;

      const stop = itin.closest_stop;
      const delaySeconds =
        si.departure_time !== si.scheduled_departure_time
          ? si.departure_time - si.scheduled_departure_time
          : null;

      vehicles.push({
        id: `transit:${si.rt_trip_id ?? si.trip_search_key ?? `${route.global_route_id}:${si.departure_time}`}`,
        provider: "transit",
        routeId: route.global_route_id ?? null,
        routeShortName: shortName,
        tripId: si.rt_trip_id ?? si.trip_search_key ?? null,
        label: null,
        lat: stop.stop_lat,
        lon: stop.stop_lon,
        bearing: null,
        speed: null,
        timestamp: si.departure_time,
        occupancy: null,
        currentStopSequence: null,
        currentStatus: null,
        agency: null,
        headsign: itin.headsign ?? itin.direction_headsign ?? null,
        statusString: si.is_real_time ? "live" : "scheduled",
        routeColor,
        delay: delaySeconds,
      });
    }
  }

  return vehicles;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

const CANBERRA_CENTER = { lat: -35.3075, lon: 149.1244 };

/**
 * Fetch nearby routes with live departures around a location.
 * Returns both routes metadata and synthesized Vehicle objects from
 * real-time schedule items.
 */
export async function fetchTransitNearbyRoutes(
  lat: number = CANBERRA_CENTER.lat,
  lon: number = CANBERRA_CENTER.lon,
  opts: {
    maxDistance?: number;
    maxNumDepartures?: number;
  } = {}
): Promise<{ routes: TransitRoute[]; vehicles: Vehicle[] }> {
  const data = await transitFetch<TransitNearbyRoutesResponse>(
    "/nearby_routes",
    {
      lat: String(lat),
      lon: String(lon),
      max_distance: String(opts.maxDistance ?? 1500),
      should_update_realtime: "true",
      max_num_departures: String(opts.maxNumDepartures ?? 5),
    }
  );

  const vehicles: Vehicle[] = [];
  for (const route of data.routes) {
    if (route.route_type === 3 || route.route_type === 700) {
      vehicles.push(...routeToVehicles(route));
    }
  }

  return { routes: data.routes, vehicles };
}

/**
 * Fetch nearby stops around a location.
 */
export async function fetchTransitNearbyStops(
  lat: number = CANBERRA_CENTER.lat,
  lon: number = CANBERRA_CENTER.lon,
  maxDistance: number = 1500
): Promise<TransitNearbyStop[]> {
  const data = await transitFetch<TransitNearbyStopsResponse>(
    "/nearby_stops",
    {
      lat: String(lat),
      lon: String(lon),
      max_distance: String(maxDistance),
    }
  );
  return data.stops;
}

/**
 * Fetch all Transit vehicles for the Canberra/Queanbeyan area.
 * Uses multiple sample points to cover the region and deduplicates.
 */
export async function fetchTransitVehicles(): Promise<Vehicle[]> {
  if (!transitConfigured()) {
    throw new Error("TRANSIT_API_KEY not set. Request one at transit.app/partners/apis");
  }

  const samplePoints = [
    { lat: -35.3075, lon: 149.1244, label: "civic" },
    { lat: -35.3495, lon: 149.2357, label: "queanbeyan" },
    { lat: -35.1853, lon: 149.1338, label: "gungahlin" },
    { lat: -35.2502, lon: 149.1389, label: "dickson" },
    { lat: -35.238, lon: 149.0846, label: "uc" },
  ];

  const allVehicles: Vehicle[] = [];
  const seenKeys = new Set<string>();

  const results = await Promise.allSettled(
    samplePoints.map(async (pt) => {
      const { vehicles } = await fetchTransitNearbyRoutes(pt.lat, pt.lon, {
        maxDistance: 1500,
        maxNumDepartures: 3,
      });
      return vehicles;
    })
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const v of result.value) {
      const key = `${v.routeShortName}:${v.headsign}:${v.timestamp}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allVehicles.push(v);
      }
    }
  }

  return allVehicles;
}

/**
 * Fetch departures for a specific route from Transit's nearby_routes data.
 * Returns schedule_items converted to a format compatible with the departures API.
 */
export async function fetchTransitDepartures(
  lat: number,
  lon: number,
  routeShortName: string
): Promise<Array<{
  tripId: string;
  departureTime: number;
  scheduledDepartureTime: number;
  isRealTime: boolean;
  isCancelled: boolean;
  headsign: string | null;
  delaySeconds: number | null;
  stopName: string;
  stopId: string;
}>> {
  const { routes } = await fetchTransitNearbyRoutes(lat, lon, {
    maxDistance: 1500,
    maxNumDepartures: 10,
  });

  const departures: Array<{
    tripId: string;
    departureTime: number;
    scheduledDepartureTime: number;
    isRealTime: boolean;
    isCancelled: boolean;
    headsign: string | null;
    delaySeconds: number | null;
    stopName: string;
    stopId: string;
  }> = [];

  const normalizedTarget = routeShortName.toLowerCase().replace(/^r/, "");

  for (const route of routes) {
    const routeNum = route.route_short_name?.toLowerCase().replace(/^r/, "") ?? "";
    if (routeNum !== normalizedTarget) continue;

    for (const itin of route.itineraries) {
      for (const si of itin.schedule_items) {
        const delay =
          si.departure_time !== si.scheduled_departure_time
            ? si.departure_time - si.scheduled_departure_time
            : null;

        departures.push({
          tripId: si.rt_trip_id ?? si.trip_search_key ?? `${si.departure_time}`,
          departureTime: si.departure_time,
          scheduledDepartureTime: si.scheduled_departure_time,
          isRealTime: si.is_real_time,
          isCancelled: si.is_cancelled,
          headsign: itin.headsign ?? itin.direction_headsign ?? null,
          delaySeconds: delay,
          stopName: itin.closest_stop.stop_name,
          stopId: itin.closest_stop.global_stop_id,
        });
      }
    }
  }

  departures.sort((a, b) => a.departureTime - b.departureTime);
  return departures;
}

// Export raw types for use in API routes
export type {
  TransitRoute,
  TransitItinerary,
  TransitScheduleItem,
  TransitStop,
  TransitNearbyStop,
};
