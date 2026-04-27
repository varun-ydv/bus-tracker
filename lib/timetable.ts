import fs from "node:fs";
import path from "node:path";
import { transitConfigured, fetchTransitDepartures as getTransitDeparturesDirect } from "./transit";

/**
 * Timetable service — answers "when does route X leave stop Y next?"
 *
 * Two sources depending on operator:
 *   • ACT (Transport Canberra)  — data/act-timetables.json, built from GTFS
 *                                  static feed (scripts/build-act-routes.py).
 *                                  Scheduled times only, works offline.
 *   • Qcity (AnyTrip) routes    — AnyTrip's public /departures endpoint.
 *                                  Returns combined schedule + live delay.
 *
 * All times are local (Australia/Sydney) in 24h "HH:MM" format. GTFS
 * frequently carries times >24:00 for trips that cross midnight — we honour
 * that when comparing against a live clock.
 */

interface StopTime {
  0: string; // stop_id
  1: string; // departure "HH:MM"
  2?: string; // arrival (if ≠ departure)
}

export interface Trip {
  id: string;
  h: string; // headsign
  s: string; // service_id
  d: number; // direction_id
  st: StopTime[];
}

interface Service {
  days: [number, number, number, number, number, number, number];
  start: string; // YYYYMMDD
  end: string;
  exceptions: Record<string, 1 | 2>; // YYYYMMDD → 1 add / 2 remove
}

interface TimetableFile {
  services: Record<string, Service>;
  routes: Record<string, { trips: Trip[] }>;
}

let cache: TimetableFile | null = null;

function load(): TimetableFile | null {
  if (cache) return cache;
  const p = path.join(process.cwd(), "data", "act-timetables.json");
  if (!fs.existsSync(p)) return null;
  cache = JSON.parse(fs.readFileSync(p, "utf-8")) as TimetableFile;
  return cache;
}

// ────────────────────────────────────────────────────────────────────────────
// Date utilities — GTFS uses calendar days in the operator's local tz.
// ────────────────────────────────────────────────────────────────────────────

const SYDNEY_TZ = "Australia/Sydney";

/** Return { yyyymmdd, minutesSinceMidnight, dayOfWeek0Mon } for a given now */
function localNow(now: Date = new Date()) {
  // Intl.DateTimeFormat is the most reliable way to get tz-local fields.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const hh = parseInt(get("hour"), 10);
  const mm = parseInt(get("minute"), 10);
  const weekdayStr = get("weekday");
  const weekdayMap: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  };
  return {
    yyyymmdd: `${y}${m}${d}`,
    minutes: hh * 60 + mm,
    dayOfWeek: weekdayMap[weekdayStr] ?? 0,
  };
}

function yesterdayOf(yyyymmdd: string): string {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10).replace(/-/g, "");
}

function isServiceActiveOn(svc: Service, date: string, dayOfWeek: number) {
  const ex = svc.exceptions[date];
  if (ex === 2) return false; // explicit removal
  if (ex === 1) return true;  // explicit addition
  if (!svc.days[dayOfWeek]) return false;
  if (svc.start && date < svc.start) return false;
  if (svc.end && date > svc.end) return false;
  return true;
}

/** "HH:MM" → minutes since midnight (handles 24+ for post-midnight trips). */
function hhmmToMinutes(s: string): number {
  const [hh, mm] = s.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return NaN;
  return hh * 60 + mm;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export interface Departure {
  tripId: string;
  time: string;            // HH:MM
  minutes: number;          // minutes since midnight on `date`
  date: string;             // YYYYMMDD the trip's service day
  headsign: string;
  direction: number;
  terminus: string | null;  // last stop's id
  terminusTime: string | null;
  /** positive = future, negative = past (in minutes from now) */
  minutesFromNow: number;
  /** live delay in seconds (AnyTrip-sourced only), null if pure schedule */
  delaySeconds?: number | null;
  /** true if this time was updated from live GPS/AVL data */
  live?: boolean;
  /** arrival time at a caller-supplied destination stop ("To" filter).
   *  Only populated when `toStopId` was passed to getDepartures(). */
  arriveTime?: string | null;
  /** trip duration in minutes origin → destination (toStop filter). */
  durationMin?: number | null;
}

/** Distinct stops served by a route, each with first/last time it's visited
 *  today (useful to pick a "default" stop). */
export function routeStops(
  shortName: string
): Array<{ id: string; count: number }> | null {
  const tt = load();
  if (!tt) return null;
  const route = tt.routes[shortName] ?? tt.routes[shortName.toUpperCase()];
  if (!route) return null;
  const counts = new Map<string, number>();
  for (const t of route.trips) {
    for (const st of t.st) {
      counts.set(st[0], (counts.get(st[0]) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);
}

export interface DeparturesResult {
  number: string;
  stopId: string;
  now: { yyyymmdd: string; hhmm: string; tz: string };
  past: Departure[];
  next: Departure[];
}

/**
 * Find departures for `routeShortName` at `stopId`.
 * Returns up to `nPrev` past + `nNext` future departures, each tagged with
 * its service day (so trips that ran post-midnight-from-yesterday still
 * show correctly).
 */
export function getDepartures(
  routeShortName: string,
  stopId: string,
  opts: {
    nPrev?: number;
    nNext?: number;
    now?: Date;
    /** If set, only include trips that visit `toStopId` after `stopId` in
     *  the same trip's stop sequence. Also populates arriveTime & durationMin. */
    toStopId?: string | null;
  } = {}
): DeparturesResult | null {
  const tt = load();
  if (!tt) return null;
  const route =
    tt.routes[routeShortName] ?? tt.routes[routeShortName.toUpperCase()];
  if (!route) return null;

  const { nPrev = 3, nNext = 5, toStopId } = opts;
  const now = localNow(opts.now);

  // Check both today's and yesterday's service days — yesterday's service day
  // can still spawn live trips at e.g. 25:30 (= 01:30 today).
  const dates: { date: string; dow: number; offsetMin: number }[] = [
    { date: now.yyyymmdd, dow: now.dayOfWeek, offsetMin: 0 },
    {
      date: yesterdayOf(now.yyyymmdd),
      dow: (now.dayOfWeek + 6) % 7,
      offsetMin: -24 * 60,
    },
  ];

  const activeByDate = new Map<string, Set<string>>();
  for (const { date, dow } of dates) {
    const active = new Set<string>();
    for (const [sid, svc] of Object.entries(tt.services)) {
      if (isServiceActiveOn(svc, date, dow)) active.add(sid);
    }
    activeByDate.set(date, active);
  }

  const departures: Departure[] = [];
  for (const trip of route.trips) {
    for (const { date, offsetMin } of dates) {
      const active = activeByDate.get(date)!;
      if (!active.has(trip.s)) continue;
      // Locate both origin and (if filtering) destination within this trip.
      let fromIdx = -1;
      let toIdx = -1;
      for (let i = 0; i < trip.st.length; i++) {
        const sid = trip.st[i][0];
        if (fromIdx === -1 && sid === stopId) fromIdx = i;
        else if (toStopId && sid === toStopId && fromIdx !== -1 && toIdx === -1) {
          toIdx = i;
          break;
        }
      }
      if (fromIdx === -1) continue;
      if (toStopId && toIdx === -1) continue; // doesn't serve destination after origin

      const fromSt = trip.st[fromIdx];
      const time = fromSt[1];
      const mins = hhmmToMinutes(time);
      if (!Number.isFinite(mins)) continue;

      const terminus = trip.st[trip.st.length - 1];
      let arriveTime: string | null = null;
      let durationMin: number | null = null;
      if (toIdx !== -1) {
        const toSt = trip.st[toIdx];
        // arrival if GTFS recorded it differently, else departure at that stop.
        arriveTime = toSt[2] ?? toSt[1];
        const arrMins = hhmmToMinutes(arriveTime);
        if (Number.isFinite(arrMins)) durationMin = arrMins - mins;
      }

      departures.push({
        tripId: trip.id,
        time,
        minutes: mins,
        date,
        headsign: trip.h,
        direction: trip.d,
        terminus: terminus?.[0] ?? null,
        terminusTime: terminus?.[1] ?? null,
        minutesFromNow: mins + offsetMin - now.minutes,
        arriveTime,
        durationMin,
      });
    }
  }

  departures.sort((a, b) => a.minutesFromNow - b.minutesFromNow);
  const past = departures
    .filter((d) => d.minutesFromNow < 0)
    .slice(-nPrev);
  const next = departures
    .filter((d) => d.minutesFromNow >= 0)
    .slice(0, nNext);

  return {
    number: routeShortName,
    stopId,
    now: {
      yyyymmdd: now.yyyymmdd,
      hhmm: `${String(Math.floor(now.minutes / 60)).padStart(2, "0")}:${String(
        now.minutes % 60
      ).padStart(2, "0")}`,
      tz: SYDNEY_TZ,
    },
    past,
    next,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// AnyTrip-backed departures (Qcity / Sydney bus routes)
// ────────────────────────────────────────────────────────────────────────────

const ANYTRIP_API_BASE = "https://api-cf-oc2.anytrip.com.au/api/v3/region/au2";
const ANYTRIP_ACT_API_BASE = "https://api-cf-au9.anytrip.com.au/api/v3/region/au9";
const ANYTRIP_USER_AGENT =
  process.env.ANYTRIP_USER_AGENT ??
  "Bus-tracker/1.0 (personal use; +https://github.com/)";

interface ATDeparturesResponse {
  response?: {
    stop?: { id?: string; name?: { station_readable_name?: string } };
    departures?: Array<{
      tripInstance?: {
        trip?: {
          id?: string;
          rtTripId?: string;
          headsign?: { headline?: string };
          directionId?: number;
          route?: { name?: string };
        };
      };
      stopTimeInstance?: {
        arrival?: { time?: number; delay?: number | null };
        departure?: { time?: number; delay?: number | null };
        firstStop?: boolean;
      };
    }>;
  };
}

/** Format a unix timestamp as Sydney-local "HH:MM". */
function unixToSydneyHHMM(unix: number): {
  hhmm: string;
  minutes: number;
  yyyymmdd: string;
} {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(unix * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hh = get("hour");
  const mm = get("minute");
  return {
    hhmm: `${hh}:${mm}`,
    minutes: parseInt(hh, 10) * 60 + parseInt(mm, 10),
    yyyymmdd: `${get("year")}${get("month")}${get("day")}`,
  };
}

export async function getAnytripDepartures(
  routeGroupId: string,
  stopId: string,
  routeShortName: string,
  opts: { nPrev?: number; nNext?: number; now?: Date } = {}
): Promise<DeparturesResult | null> {
  const { nPrev = 3, nNext = 6 } = opts;
  const nowDate = opts.now ?? new Date();
  const nowUnix = Math.floor(nowDate.getTime() / 1000);

  const apiBase = routeGroupId.startsWith("au9:") ? ANYTRIP_ACT_API_BASE : ANYTRIP_API_BASE;
  const url = new URL(`${apiBase}/departures/${encodeURIComponent(stopId)}`);
  url.searchParams.set("limit", String(nPrev + nNext + 10));
  url.searchParams.set("offset", String(-Math.max(nPrev + 2, 3)));
  url.searchParams.set("ts", String(nowUnix));
  url.searchParams.set("routeGroupIds", routeGroupId);

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": ANYTRIP_USER_AGENT,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`anytrip departures HTTP ${res.status}`);
  }
  const json = (await res.json()) as ATDeparturesResponse;
  const raw = json.response?.departures ?? [];

  const now = localNow(nowDate);
  const departures: Departure[] = [];
  for (const d of raw) {
    const trip = d.tripInstance?.trip;
    const route = trip?.route;
    // defensive — router must match (but we filter by routeGroupIds so this
    // should always be true).
    if (route?.name && route.name !== routeShortName) continue;
    const st = d.stopTimeInstance;
    const dep = st?.departure?.time ?? st?.arrival?.time;
    if (!dep) continue;
    const delay = st?.departure?.delay ?? st?.arrival?.delay ?? null;
    const local = unixToSydneyHHMM(dep);
    departures.push({
      tripId: trip?.rtTripId ?? trip?.id ?? `${dep}`,
      time: local.hhmm,
      minutes: local.minutes,
      date: local.yyyymmdd,
      headsign: trip?.headsign?.headline ?? "",
      direction: trip?.directionId ?? 0,
      terminus: null,
      terminusTime: null,
      minutesFromNow: Math.round((dep - nowUnix) / 60),
      delaySeconds: typeof delay === "number" ? delay : null,
      live: typeof delay === "number",
    });
  }
  departures.sort((a, b) => a.minutesFromNow - b.minutesFromNow);
  const past = departures.filter((d) => d.minutesFromNow < 0).slice(-nPrev);
  const next = departures
    .filter((d) => d.minutesFromNow >= 0)
    .slice(0, nNext);

  return {
    number: routeShortName,
    stopId,
    now: {
      yyyymmdd: now.yyyymmdd,
      hhmm: `${String(Math.floor(now.minutes / 60)).padStart(2, "0")}:${String(
        now.minutes % 60
      ).padStart(2, "0")}`,
      tz: SYDNEY_TZ,
    },
    past,
    next,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Transit App-backed departures — delegates to lib/transit.ts
// ────────────────────────────────────────────────────────────────────────────

export async function getTransitDepartures(
  routeShortName: string,
  stop: { id: string; name: string; lat: number; lon: number },
  opts: { nPrev?: number; nNext?: number; now?: Date } = {}
): Promise<DeparturesResult | null> {
  if (!transitConfigured()) return null;

  const nowDate = opts.now ?? new Date();

  const items = await getTransitDeparturesDirect(stop.lat, stop.lon, routeShortName);
  if (!items || items.length === 0) return null;

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const toHhmm = (epochSec: number) => {
    const d = new Date(epochSec * 1000);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  const toyyyymmdd = (d: Date) =>
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;

  const past: Departure[] = [];
  const next: Departure[] = [];

  for (const item of items) {
    const minutesFromNow = Math.round((item.departureTime * 1000 - nowDate.getTime()) / 60000);
    const dep: Departure = {
      tripId: item.tripId,
      time: toHhmm(item.departureTime),
      minutes: minutesFromNow,
      date: toyyyymmdd(nowDate),
      headsign: item.headsign ?? "",
      direction: 0,
      terminus: null,
      terminusTime: null,
      minutesFromNow,
      delaySeconds: item.delaySeconds,
      live: item.isRealTime,
    };

    if (minutesFromNow <= 0) {
      past.push(dep);
    } else {
      next.push(dep);
    }
  }

  past.sort((a, b) => b.minutesFromNow - a.minutesFromNow);
  next.sort((a, b) => a.minutesFromNow - b.minutesFromNow);

  return {
    number: routeShortName,
    stopId: stop.id,
    now: { hhmm: toHhmm(Math.floor(nowDate.getTime() / 1000)), yyyymmdd: toyyyymmdd(nowDate), tz: "Australia/Sydney" },
    past: past.slice(-(opts.nPrev ?? 3)),
    next: next.slice(0, opts.nNext ?? 6),
  };
}

