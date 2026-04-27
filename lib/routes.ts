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
 * Known AnyTrip route-group ids for Qcity routes (NSW au2 region).
 * Hard-coding saves a round-trip when the user drills into a route.
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

/**
 * AnyTrip route-group ids for ACT Transport Canberra routes (au9 region).
 * Rapid routes 1-10 are prefixed with "R" in AnyTrip's au9 region.
 * Regular routes use the same number.
 *
 * Maps the canonical route number (as used in the GTFS feed and UI) to the
 * au9 route-group ID. This allows the departures API to request live/scheduled
 * departures from AnyTrip for ACT routes.
 */
export const ANYTRIP_ACT_ROUTE_GROUPS: Record<string, string> = {
  "1": "au9:lightrail:R1",
  "2": "au9:buses:R2",
  "3": "au9:buses:R3",
  "4": "au9:buses:R4",
  "5": "au9:buses:R5",
  "6": "au9:buses:R6",
  "7": "au9:buses:R7",
  "8": "au9:buses:R8",
  "9": "au9:buses:R9",
  "10": "au9:buses:R10",
  "18": "au9:buses:18",
  "19": "au9:buses:19",
  "20": "au9:buses:20",
  "21": "au9:buses:21",
  "22": "au9:buses:22",
  "23": "au9:buses:23",
  "24": "au9:buses:24",
  "25": "au9:buses:25",
  "26": "au9:buses:26",
  "27": "au9:buses:27",
  "28": "au9:buses:28",
  "30": "au9:buses:30",
  "31": "au9:buses:31",
  "32": "au9:buses:32",
  "40": "au9:buses:40",
  "41": "au9:buses:41",
  "42": "au9:buses:42",
  "43": "au9:buses:43",
  "44": "au9:buses:44",
  "45": "au9:buses:45",
  "46": "au9:buses:46",
  "47": "au9:buses:47",
  "50": "au9:buses:50",
  "51": "au9:buses:51",
  "52": "au9:buses:52",
  "53": "au9:buses:53",
  "54": "au9:buses:54",
  "55": "au9:buses:55",
  "56": "au9:buses:56",
  "57": "au9:buses:57",
  "58": "au9:buses:58",
  "59": "au9:buses:59",
  "60": "au9:buses:60",
  "61": "au9:buses:61",
  "62": "au9:buses:62",
  "63": "au9:buses:63",
  "64": "au9:buses:64",
  "65": "au9:buses:65",
  "66": "au9:buses:66",
  "70": "au9:buses:70",
  "71": "au9:buses:71",
  "72": "au9:buses:72",
  "73": "au9:buses:73",
  "74": "au9:buses:74",
  "75": "au9:buses:75",
  "76": "au9:buses:76",
  "77": "au9:buses:77",
  "78": "au9:buses:78",
  "79": "au9:buses:79",
  "80": "au9:buses:80",
  "81": "au9:buses:81",
};

/** AnyTrip API base URL for the ACT au9 region. */
export const ANYTRIP_ACT_API_BASE =
  "https://api-cf-au9.anytrip.com.au/api/v3/region/au9";

/** The AnyTrip route name for a given ACT route number.
 *  e.g. "2" → "R2", "30" → "30" */
export function anytripActRouteName(routeNumber: string): string {
  const rapid = parseInt(routeNumber, 10);
  if (rapid >= 1 && rapid <= 10) return `R${routeNumber}`;
  return routeNumber;
}

// ────────────────────────────────────────────────────────────────────────────
// Dynamic AnyTrip route-group discovery
// ────────────────────────────────────────────────────────────────────────────

interface ATSearchResp {
  response?: {
    routeGroups?: Array<{
      routeGroup?: {
        id?: string;
        name?: string;
        longName?: string;
        description?: string;
      };
    }>;
  };
}

const routeGroupCache = new Map<string, string | null>();
const ROUTE_GROUP_CACHE_TTL = 30 * 60 * 1000;
const routeGroupCacheTimestamps = new Map<string, number>();

/**
 * Resolve a route short name to an AnyTrip route-group ID.
 * Checks hardcoded mappings (Qcity au2 + ACT au9) first, then falls back to
 * a live search against the AnyTrip search API (with caching).
 *
 * Returns null if no matching route group is found.
 */
export async function resolveAnytripRouteGroupId(
  routeNumber: string
): Promise<string | null> {
  // Check hardcoded Qcity (au2) routes first
  const qcity = ANYTRIP_ROUTE_GROUPS[routeNumber];
  if (qcity) return qcity;

  // Check hardcoded ACT (au9) routes
  const act = ANYTRIP_ACT_ROUTE_GROUPS[routeNumber];
  if (act) return act;

  const now = Date.now();
  const ts = routeGroupCacheTimestamps.get(routeNumber);
  if (ts !== undefined && now - ts < ROUTE_GROUP_CACHE_TTL) {
    return routeGroupCache.get(routeNumber) ?? null;
  }

  const headers = {
    "User-Agent": ANYTRIP_USER_AGENT,
    Accept: "application/json",
  };

  const saveResult = (id: string | null) => {
    routeGroupCache.set(routeNumber, id);
    routeGroupCacheTimestamps.set(routeNumber, now);
    return id;
  };

  try {
    // Try ACT au9 region search first
    const res1 = await fetch(
      `${ANYTRIP_ACT_API_BASE}/search?query=${encodeURIComponent(anytripActRouteName(routeNumber))}&limit=5`,
      { headers, cache: "no-store" }
    );
    if (res1.ok) {
      const json = (await res1.json()) as ATSearchResp;
      const candidates = json.response?.routeGroups ?? [];
      const atName = anytripActRouteName(routeNumber);
      const match = candidates.find(
        (c) => c.routeGroup?.name === atName
      );
      if (match?.routeGroup?.id) {
        return saveResult(match.routeGroup.id);
      }
    }

    // Then try NSW au2 region search
    const res2 = await fetch(
      `${ANYTRIP_API_BASE}/search?query=${encodeURIComponent(routeNumber)}&limit=15`,
      { headers, cache: "no-store" }
    );
    if (res2.ok) {
      const json = (await res2.json()) as ATSearchResp;
      const candidates = json.response?.routeGroups ?? [];
      const match = candidates.find(
        (c) => c.routeGroup?.name === routeNumber
      );
      if (match?.routeGroup?.id) {
        return saveResult(match.routeGroup.id);
      }
    }

    return saveResult(null);
  } catch {
    return saveResult(null);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// AnyTrip stop-name enrichment
// ────────────────────────────────────────────────────────────────────────────

interface ATStopDetailResp {
  response?: {
    stop?: {
      id?: string;
      fullName?: string;
      name?: {
        station_readable_name?: string;
        station_name?: string;
        platform_readable_name?: string;
        platform_name?: string;
        platform_type?: string;
      };
      disassembled?: {
        fullName?: string;
        stationName?: string;
        platformCombinedName?: string;
      };
    };
  };
}

const stopNameCache = new Map<string, string | null>();

/**
 * Look up richer stop metadata from AnyTrip for a single GTFS stop ID.
 * Tries the ACT au9 region first (for Transport Canberra stops), then falls
 * back to the NSW au2 region (for shared stops like Qcity interchanges).
 *
 * Returns the enriched full name (e.g. "Westfield Belconnen, Platform 2, Set Down Only")
 * or null if the stop isn't known to AnyTrip.
 */
async function lookupAnytripStopName(
  gtfsStopId: string
): Promise<string | null> {
  if (stopNameCache.has(gtfsStopId)) return stopNameCache.get(gtfsStopId)!;

  const headers = {
    "User-Agent": ANYTRIP_USER_AGENT,
    Accept: "application/json",
  };

  const extractName = (json: ATStopDetailResp): string | null => {
    const stop = json.response?.stop;
    return (
      stop?.disassembled?.fullName ??
      stop?.fullName ??
      stop?.name?.platform_readable_name ??
      stop?.name?.station_readable_name ??
      null
    );
  };

  try {
    // Try ACT au9 region first
    const au9Id = `au9:${gtfsStopId}`;
    const res9 = await fetch(
      `${ANYTRIP_ACT_API_BASE}/stop/${encodeURIComponent(au9Id)}`,
      { headers, cache: "no-store" }
    );
    if (res9.ok) {
      const json = (await res9.json()) as ATStopDetailResp;
      const name = extractName(json);
      if (name) {
        stopNameCache.set(gtfsStopId, name);
        return name;
      }
    }

    // Fall back to NSW au2 region
    const au2Id = `au2:${gtfsStopId}`;
    const res2 = await fetch(
      `${ANYTRIP_API_BASE}/stop/${encodeURIComponent(au2Id)}`,
      { headers, cache: "no-store" }
    );
    if (res2.ok) {
      const json = (await res2.json()) as ATStopDetailResp;
      const name = extractName(json);
      if (name) {
        stopNameCache.set(gtfsStopId, name);
        return name;
      }
    }

    stopNameCache.set(gtfsStopId, null);
    return null;
  } catch {
    stopNameCache.set(gtfsStopId, null);
    return null;
  }
}

/**
 * Batch-enrich stop names using AnyTrip's stop metadata.
 * Returns a map from GTFS stop ID to the enriched name.
 * Stops that can't be resolved are omitted from the map.
 */
export async function enrichStopNamesFromAnytrip(
  stopIds: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const uncached: string[] = [];
  for (const id of stopIds) {
    if (stopNameCache.has(id)) {
      const cached = stopNameCache.get(id);
      if (cached) result.set(id, cached);
    } else {
      uncached.push(id);
    }
  }
  if (uncached.length === 0) return result;

  // Fetch up to 20 stops concurrently to avoid overwhelming the API
  const batchSize = 20;
  for (let i = 0; i < uncached.length; i += batchSize) {
    const batch = uncached.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map(async (id) => {
        const name = await lookupAnytripStopName(id);
        if (name) return { id, name };
        return null;
      })
    );
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value) {
        result.set(r.value.id, r.value.name);
      }
    }
  }
  return result;
}

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
