import fs from "node:fs";
import path from "node:path";
import type { FavouriteRoute } from "./favourites";
import { FAVOURITE_ROUTES } from "./favourites";

/**
 * Route shape + stops catalogue.
 *
 *   ACT (Transport Canberra)  — pre-built from GTFS static into data/act-routes.json.
 *                               Built by scripts/build-act-routes.py.
 *
 *   Qcity / AnyTrip routes    — fetched live from AnyTrip's routeGroup API
 *                               (same endpoint their map UI uses, no auth).
 *
 * All results are normalised to: { shapes: [[lat,lon], ...][], stops: [...] }
 * Responses are cached in-memory for CACHE_TTL_MS (1h for ACT, 10m for AnyTrip
 * since their shape data rarely changes).
 */

export interface RouteStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface RouteShape {
  id?: string;
  /** ordered [lat, lon] pairs for a single direction/variant */
  points: [number, number][];
}

export interface RouteGeometry {
  number: string;
  color?: string | null;
  agency?: string | null;
  shapes: RouteShape[];
  stops: RouteStop[];
  source: "act-gtfs" | "anytrip";
}

// ────────────────────────────────────────────────────────────────────────────
// ACT side — read pre-built JSON once, cache forever.
// ────────────────────────────────────────────────────────────────────────────

interface ActRouteEntry {
  shapes: number[][][];
  stops: RouteStop[];
  color?: string;
}

let actCatalogue: Record<string, ActRouteEntry> | null = null;

function loadActCatalogue(): Record<string, ActRouteEntry> {
  if (actCatalogue) return actCatalogue;
  const p = path.join(process.cwd(), "data", "act-routes.json");
  if (!fs.existsSync(p)) {
    console.warn("[routes] act-routes.json not found; run scripts/build-act-routes.py");
    actCatalogue = {};
    return actCatalogue;
  }
  const raw = fs.readFileSync(p, "utf-8");
  actCatalogue = JSON.parse(raw) as Record<string, ActRouteEntry>;
  return actCatalogue;
}

function getActRoute(number: string): RouteGeometry | null {
  const cat = loadActCatalogue();
  const entry = cat[number] ?? cat[number.toUpperCase()];
  if (!entry) return null;
  return {
    number,
    color: entry.color ?? null,
    agency: "Transport Canberra",
    source: "act-gtfs",
    shapes: entry.shapes.map((points) => ({
      points: points.map(([la, lo]) => [la, lo] as [number, number]),
    })),
    stops: entry.stops,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// AnyTrip side — call the same JSON endpoints their web app uses.
// ────────────────────────────────────────────────────────────────────────────

const ANYTRIP_API_BASE = "https://api-cf-oc2.anytrip.com.au/api/v3/region/au2";
const ANYTRIP_USER_AGENT =
  process.env.ANYTRIP_USER_AGENT ??
  "Bus-tracker/1.0 (personal use; +https://github.com/)";

interface ATShapesResp {
  response?: {
    shapes?: Array<{ id?: string; enc?: string; color?: string }>;
    routeGroup?: { color?: string; name?: string; longName?: string };
  };
}
interface ATStop {
  id?: string;
  fullName?: string;
  name?: { station_readable_name?: string; station_name?: string };
  coordinates?: { lat?: number; lon?: number };
}
interface ATStopsResp {
  response?: {
    routeGroup?: {
      id?: string;
      name?: string;
      longName?: string;
      color?: string;
    };
    routeStops?: Array<{ stop?: ATStop }>;
  };
}

/** Google Encoded Polyline Algorithm Format decoder. */
function decodePolyline(str: string): [number, number][] {
  const out: [number, number][] = [];
  let index = 0, lat = 0, lon = 0;
  while (index < str.length) {
    let b: number, shift = 0, result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlon = result & 1 ? ~(result >> 1) : result >> 1;
    lon += dlon;

    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}

/**
 * Known AnyTrip route-group ids for Qcity routes. (We could discover them
 * dynamically off the vehicles feed, but hard-coding the handful we care about
 * saves a round-trip when the user drills into a route with no live bus.)
 *
 * Exported so the timetable layer can dispatch Qcity routes to AnyTrip's
 * /departures endpoint instead of looking for them in the ACT GTFS static.
 */
export const ANYTRIP_ROUTE_GROUPS: Record<string, string> = {
  "830": "au2:buses:830:6015",
  "831": "au2:buses:831:6015",
  "832": "au2:buses:832:6015",
  "833": "au2:buses:833:6015",
  "834": "au2:buses:834:6015",
  "835": "au2:buses:835:6015",
  "836": "au2:buses:836:6015",
  "837": "au2:buses:837:6015",
  "838": "au2:buses:838:6015",
  "844": "au2:buses:844:6015",
  "844X": "au2:buses:844X:6015",
};

interface AnytripCacheEntry { data: RouteGeometry; at: number }
const anytripCache = new Map<string, AnytripCacheEntry>();
const ANYTRIP_TTL = 10 * 60 * 1000;

async function getAnytripRoute(number: string): Promise<RouteGeometry | null> {
  const routeGroupId = ANYTRIP_ROUTE_GROUPS[number];
  if (!routeGroupId) return null;

  const cached = anytripCache.get(number);
  if (cached && Date.now() - cached.at < ANYTRIP_TTL) return cached.data;

  const enc = encodeURIComponent(routeGroupId);
  const headers = { "User-Agent": ANYTRIP_USER_AGENT, Accept: "application/json" };

  const [shapesRes, stopsRes] = await Promise.all([
    fetch(`${ANYTRIP_API_BASE}/routeGroup/${enc}/shapes`, { headers, cache: "no-store" }),
    fetch(`${ANYTRIP_API_BASE}/routeGroup/${enc}/stops`, { headers, cache: "no-store" }),
  ]);

  if (!shapesRes.ok) {
    throw new Error(`anytrip shapes HTTP ${shapesRes.status}`);
  }

  const shapesJson = (await shapesRes.json()) as ATShapesResp;
  const shapes: RouteShape[] = [];
  for (const s of shapesJson.response?.shapes ?? []) {
    if (!s.enc) continue;
    const points = decodePolyline(s.enc);
    if (points.length < 2) continue;
    shapes.push({ id: s.id, points });
  }

  let color: string | null = null;
  const stops: RouteStop[] = [];
  if (stopsRes.ok) {
    const stopsJson = (await stopsRes.json()) as ATStopsResp;
    const rg = stopsJson.response?.routeGroup;
    if (rg?.color) color = `#${rg.color}`;
    const seen = new Set<string>();
    for (const rs of stopsJson.response?.routeStops ?? []) {
      const stop = rs.stop;
      const lat = stop?.coordinates?.lat;
      const lon = stop?.coordinates?.lon;
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      const id = stop?.id ?? `${lat},${lon}`;
      if (seen.has(id)) continue;
      seen.add(id);
      stops.push({
        id,
        name: (stop?.name?.station_readable_name
          ?? stop?.fullName
          ?? stop?.name?.station_name
          ?? "").trim(),
        lat,
        lon,
      });
    }
  }
  // Fallback: derive color from the shapes payload if stops didn't carry it.
  if (!color) {
    const rgShapes = shapesJson.response?.routeGroup?.color;
    if (rgShapes) color = `#${rgShapes}`;
  }

  const geometry: RouteGeometry = {
    number,
    color,
    agency: "Qcity Transit",
    source: "anytrip",
    shapes,
    stops,
  };
  anytripCache.set(number, { data: geometry, at: Date.now() });
  return geometry;
}

// ────────────────────────────────────────────────────────────────────────────
// Public: dispatch to the right provider based on the favourites catalogue.
// ────────────────────────────────────────────────────────────────────────────

function findFavourite(number: string): FavouriteRoute | null {
  const n = number.trim().toLowerCase();
  return (
    FAVOURITE_ROUTES.find(
      (r) =>
        r.number.toLowerCase() === n ||
        r.aliases?.some((a) => a.toLowerCase() === n)
    ) ?? null
  );
}

/** Canonical number (e.g. "R1" → "1" via the favourites aliases). */
export function canonicalRouteNumber(number: string): string {
  const f = findFavourite(number);
  return f?.number ?? number;
}

export async function fetchRouteGeometry(
  number: string
): Promise<RouteGeometry | null> {
  const canonical = canonicalRouteNumber(number);
  const fav = findFavourite(canonical);

  // If we know this is an AnyTrip route, try there first.
  if (fav?.providers?.includes("anytrip")) {
    const g = await getAnytripRoute(canonical);
    if (g) return g;
  }
  // ACT-side (most favourites).
  if (!fav || fav.providers?.includes("canberra")) {
    const g = getActRoute(canonical);
    if (g) return g;
  }
  // Fallback: try AnyTrip for unknown routes.
  if (!fav) {
    try {
      const g = await getAnytripRoute(canonical);
      if (g) return g;
    } catch {
      // swallow
    }
  }
  return null;
}
