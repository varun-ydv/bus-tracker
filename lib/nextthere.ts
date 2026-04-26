import { createHmac } from "crypto";
import type { Vehicle } from "./types";

const NT_SECRET = process.env.NEXTTHERE_HMAC_SECRET ?? "RCysfU7Udj7EG5nyF3MEgnJGAnphq0u";
const NT_APP_ID = "nextthere-web";
const NT_CDN_BASE = "https://cdn-api-public.nextthere.com";
const NT_REGION = "au_canberra";
const CACHE_TTL_MS = 8_000;

function hmacSign(path: string, query = ""): string {
  const stringToSign = path + (query ? "?" + query : "");
  const sig = createHmac("sha256", NT_SECRET).update(stringToSign).digest("base64");
  return `AppAuth method=HMAC-SHA256 applicationId=${NT_APP_ID} signature=${sig}`;
}

async function ntFetch<T>(path: string, query = ""): Promise<T> {
  const auth = hmacSign(path, query);
  const url = `${NT_CDN_BASE}${path}${query ? "?" + query : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: auth, Accept: "application/json" },
    cache: "no-store",
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`nextthere ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`);
  return res.json() as Promise<T>;
}

interface NTPosition {
  latitude: number;
  longitude: number;
  bearing: number;
  speed: number;
}

interface NTVehicleRaw {
  id: string;
  position: NTPosition;
  timestamp: number;
  tripId: string;
  routeId: string;
  routeType: number;
  routeShortName?: string;
  agencyId?: string;
  background?: string;
  foreground?: string;
  activityStatus?: number;
  delay?: number;
  shapeId?: number;
  headsign?: string;
  dep?: number;
  tripInstanceId?: number;
  statusText?: string;
  vehicleId?: string;
  vehicleOccupancyStatus?: number;
  isTimetabled?: boolean;
}

interface NTQueryResponse {
  timestamp: number;
  refreshIn: number;
  vehicles: NTVehicleRaw[];
}

interface NTStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  platformCode?: string;
  location?: string;
  icon?: string;
}

interface NTVehicleInfo {
  vehicleType?: {
    name?: string;
    capacity?: number;
    seated?: number;
    standing?: number;
    ac?: boolean;
    accessible?: boolean;
    fuel?: string;
    bicycle?: boolean;
  };
}

interface NTTripInstance {
  id: string;
  key: number;
  headsign: string;
  directionId: number;
  currentDelay: number;
  vehicleId: string;
  vehicleStatus?: string;
  vehicleOccupancyStatus: number;
  vehicleInfo?: NTVehicleInfo;
  position?: NTPosition;
  backgroundColour?: string;
  textColour?: string;
  agencyId: string;
  startTime: number;
  endTime: number;
  shapeId: number;
}

interface NTJourneyLeg {
  tripInstance: NTTripInstance;
}

interface NTJourney {
  id: string;
  legs: NTJourneyLeg[];
}

interface NTTimelineResponse {
  status: string;
  result: {
    journeys: NTJourney[];
    pagination: { count: number; countAbove: number };
  };
}

interface NTSearchResult {
  key: string;
  title: string;
  type: string;
  abstract?: string;
  properties: NTStop & { background?: string; foreground?: string };
}

interface NTSearchResponse {
  results: NTSearchResult[];
  count: { total: number };
}

interface NTStopInfoResponse {
  stop: NTStop;
  routes: Array<{
    id: string;
    shortName: string;
    longName: string;
    backgroundColour: string;
    textColour: string;
    agencyName: string;
  }>;
}

const OCCUPANCY_MAP: Record<number, string> = {
  0: "EMPTY",
  1: "MANY_SEATS_AVAILABLE",
  2: "FEW_SEATS_AVAILABLE",
  3: "STANDING_ROOM_ONLY",
  4: "CRUSHED_STANDING_ROOM_ONLY",
  5: "FULL",
  6: "NOT_ACCEPTING_PASSENGERS",
};

const CANBERRA_BBOX = {
  sw: { lat: -35.48, lon: 149.0 },
  ne: { lat: -35.15, lon: 149.21 },
};

let vehicleCache: { data: Vehicle[]; at: number; serverTs: number } | null = null;

export function nextthereConfigured(): boolean {
  return true;
}

function mapVehicle(v: NTVehicleRaw): Vehicle {
  return {
    id: `nt:${v.id}`,
    provider: "nextthere",
    routeId: v.routeId || null,
    routeShortName: v.routeShortName || null,
    tripId: v.tripId || null,
    label: v.id || null,
    lat: v.position.latitude,
    lon: v.position.longitude,
    bearing: v.position.bearing ?? null,
    speed: v.position.speed ?? null,
    timestamp: v.timestamp,
    occupancy: v.vehicleOccupancyStatus != null ? OCCUPANCY_MAP[v.vehicleOccupancyStatus] ?? null : null,
    currentStopSequence: null,
    currentStatus: v.statusText ?? null,
    agency: v.agencyId === "TC" ? "Transport Canberra" : v.agencyId === "6015" ? "Qcity Transit" : (v.agencyId ?? null),
    headsign: v.headsign ?? null,
    statusString: v.statusText ?? null,
    routeColor: v.background ? `#${v.background}` : null,
    delay: v.delay ?? null,
  };
}

export async function fetchNextthereVehicles(): Promise<Vehicle[]> {
  if (vehicleCache && Date.now() - vehicleCache.at < CACHE_TTL_MS) {
    return vehicleCache.data;
  }

  const since = vehicleCache?.serverTs ? `&since=${vehicleCache.serverTs}` : "";
  const bust = `&_=${Date.now()}`;
  const q = `region=${CANBERRA_BBOX.sw.lat},${CANBERRA_BBOX.sw.lon},${CANBERRA_BBOX.ne.lat},${CANBERRA_BBOX.ne.lon}&w=800&h=800&z=11${since}${bust}`;
  const data = await ntFetch<NTQueryResponse>(`/${NT_REGION}/query`, q);

  const vehicles = data.vehicles
    .filter((v) => v.routeType === 700)
    .map(mapVehicle);

  vehicleCache = { data: vehicles, at: Date.now(), serverTs: data.timestamp };
  return vehicles;
}

export async function fetchStopVehicles(stopId: string): Promise<{
  stop: NTStop;
  vehicles: Vehicle[];
}> {
  const data = await ntFetch<{ stop: NTStop; vehicles: NTVehicleRaw[] }>(
    `/${NT_REGION}/stop/${stopId}/vehicles`
  );
  return {
    stop: data.stop,
    vehicles: data.vehicles.filter((v) => v.routeType === 700).map(mapVehicle),
  };
}

export async function fetchStopDepartures(stopId: string, limit = 20): Promise<{
  stop: NTStop;
  journeys: NTJourney[];
}> {
  const q = `originStopId=${encodeURIComponent(stopId)}&limit=${limit}&allowTransfers=true`;
  const data = await ntFetch<NTTimelineResponse>(`/${NT_REGION}/journey/timeline`, q);
  if (data.status !== "success" || !data.result) {
    throw new Error("nextthere timeline: no results");
  }
  const journeys = data.result.journeys;
  const firstStop = journeys[0]?.legs[0]?.tripInstance;
  const stop: NTStop = {
    id: stopId,
    name: "Stop",
    lat: 0,
    lon: 0,
  };
  return { stop, journeys };
}

export async function searchStops(query: string, limit = 20): Promise<NTSearchResult[]> {
  const q = `terms=${encodeURIComponent(query)}&region=${NT_REGION}&types=stop&limit=${limit}`;
  const data = await ntFetch<NTSearchResponse>("/v1/search", q);
  return data.results.filter((r) => r.type === "stop");
}

export async function searchRoutes(query: string, limit = 20): Promise<NTSearchResult[]> {
  const q = `terms=${encodeURIComponent(query)}&region=${NT_REGION}&types=route&limit=${limit}`;
  const data = await ntFetch<NTSearchResponse>("/v1/search", q);
  return data.results.filter((r) => r.type === "route");
}

export async function fetchStopInfo(stopId: string): Promise<NTStopInfoResponse> {
  return ntFetch<NTStopInfoResponse>(`/${NT_REGION}/stop/${stopId}/info`);
}

export async function fetchRegionConfig() {
  const data = await ntFetch<{ regions: NTStop[] }>("/v1/application/config");
  return data;
}

export type {
  NTSearchResult,
  NTStop,
  NTJourney,
  NTTripInstance,
  NTVehicleInfo,
  NTStopInfoResponse,
  NTTimelineResponse,
};
