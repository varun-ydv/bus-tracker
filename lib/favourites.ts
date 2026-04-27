import type { Provider, Vehicle } from "./types";

/**
 * Curated favourite routes for this user.
 * Each entry pins the route number to the operator(s) that actually run it,
 * so e.g. ACT route "50" doesn't accidentally surface the Premier Illawarra
 * "50" running around Wollongong.
 *
 * Note on naming: ACTION renumbered the Rapid network in 2023 — the old
 * R1 .. R10 became routes 1 .. 10. The `aliases` field lets the search box
 * still find them by their old name.
 */
export interface FavouriteRoute {
  /** route short name as broadcast in the live feed */
  number: string;
  /** allowed providers; if omitted, all providers match */
  providers?: Provider[];
  /** restrict to a specific operator (case-insensitive substring match) */
  agencyContains?: string;
  /** display label on the chip; defaults to `number` */
  label?: string;
  /** other names (e.g. legacy "R1") that should still resolve to this route */
  aliases?: string[];
}

export const FAVOURITE_ROUTES: FavouriteRoute[] = [
  { number: "1", providers: ["canberra", "nextthere", "transit", "anytrip"], label: "1 · R1", aliases: ["r1"] },
  { number: "2", providers: ["canberra", "nextthere", "transit", "anytrip"], label: "2 · R2", aliases: ["r2"] },
  { number: "3", providers: ["canberra", "nextthere", "transit", "anytrip"], label: "3 · R3", aliases: ["r3"] },
  { number: "4", providers: ["canberra", "nextthere", "transit", "anytrip"], label: "4 · R4", aliases: ["r4"] },
  { number: "5", providers: ["canberra", "nextthere", "transit", "anytrip"], label: "5 · R5", aliases: ["r5"] },
  { number: "6", providers: ["canberra", "nextthere", "transit", "anytrip"], label: "6 · R6", aliases: ["r6"] },
  { number: "7", providers: ["canberra", "nextthere", "transit", "anytrip"], label: "7 · R7", aliases: ["r7"] },
  { number: "8", providers: ["canberra", "nextthere", "transit", "anytrip"], label: "8 · R8", aliases: ["r8"] },
  { number: "9", providers: ["canberra", "nextthere", "transit", "anytrip"], label: "9 · R9", aliases: ["r9"] },
  { number: "10", providers: ["canberra", "nextthere", "transit", "anytrip"], label: "10 · R10", aliases: ["r10"] },
  { number: "31", providers: ["canberra", "nextthere", "transit", "anytrip"], agencyContains: "transport canberra" },
  { number: "50", providers: ["canberra", "nextthere", "transit", "anytrip"], agencyContains: "transport canberra" },
  { number: "51", providers: ["canberra", "nextthere", "transit", "anytrip"], agencyContains: "transport canberra" },
  { number: "53", providers: ["canberra", "nextthere", "transit", "anytrip"], agencyContains: "transport canberra" },
  { number: "830", providers: ["anytrip", "nextthere"], agencyContains: "qcity" },
  { number: "831", providers: ["anytrip", "nextthere"], agencyContains: "qcity" },
];

/** Default = the whole favourites list (what tapping "My buses" applies). */
export const DEFAULT_FAVOURITE_NUMBERS = FAVOURITE_ROUTES.map((r) => r.number);

/**
 * A Place is an interchange / hub. Picking a place shows every bus whose
 * *route* is known to serve that place (regardless of where it is right now),
 * plus any bus whose live destination headsign mentions the place.
 *
 * Each route entry can be scoped to a provider/agency so e.g. Qcity's 830
 * matches but a Sydney route also numbered 859 does not.
 */
export interface PlaceRoute {
  number: string;
  providers?: Provider[];
  agencyContains?: string;
}

export interface Place {
  id: string;
  name: string;
  /** routes known to call at any stand/stop of this place */
  routes: PlaceRoute[];
  /** headsign substrings (lowercase) that imply the bus is heading here */
  headsignIncludes: string[];
  /**
   * Providers a vehicle must belong to for this place to consider it at all.
   * Prevents e.g. Sydney AnyTrip buses (whose headsigns contain "City") from
   * leaking into the Canberra City place via the headsign fallback.
   * If provided, it also constrains AnyTrip vehicles to specific agencies.
   */
  providerScope?: {
    providers: Provider[];
    /** When AnyTrip is in providers, only these agencies count. */
    anytripAgencies?: string[];
  };
  /** optional rough centre + radius for the map's auto-fit on this place */
  lat?: number;
  lon?: number;
  radiusMeters?: number;
}

/** ACT-side places: match ACT buses + Qcity buses only (no other Sydney/regional AnyTrip). */
const ACT_SCOPE: Place["providerScope"] = {
  providers: ["canberra", "anytrip", "nextthere", "transit"],
  anytripAgencies: ["qcity", "transport canberra"],
};
/** Queanbeyan: Qcity only (ACT feed doesn't cover NSW). */
const QCITY_SCOPE: Place["providerScope"] = {
  providers: ["anytrip", "nextthere", "transit"],
  anytripAgencies: ["qcity"],
};

const act = (number: string): PlaceRoute => ({
  number,
  providers: ["canberra", "nextthere", "transit", "anytrip"],
});
const acts = (...nums: string[]): PlaceRoute[] => nums.map(act);
const qcity = (number: string): PlaceRoute => ({
  number,
  providers: ["anytrip", "nextthere"],
  agencyContains: "qcity",
});
const qcs = (...nums: string[]): PlaceRoute[] => nums.map(qcity);
/** Transborder / Deanes / Berry's — regional coaches through Qbn / Canberra. */
const regional = (
  number: string,
  agencyContains?: string
): PlaceRoute => ({
  number,
  providers: ["anytrip"],
  ...(agencyContains ? { agencyContains } : {}),
});

/**
 * Route catalogues below combine the ACT 2023 Combined Network + Qcity's
 * Queanbeyan-based timetables. Headsign fallbacks catch odd routes we don't
 * enumerate explicitly (e.g. rare school services, replacement buses).
 *
 * Edit these freely — the UI will pick up changes immediately.
 */
export const PLACES: Place[] = [
  {
    id: "queanbeyan",
    name: "Queanbeyan",
    // Every route below is Qcity Transit (verified against AnyTrip's
    // routeGroup catalogue). The Sydney-area 858/859 share the number but
    // are operated by Transit Systems NSW SW — we deliberately DO NOT include
    // them, and the agencyContains filter would reject them anyway.
    routes: [
      ...qcs(
        "830", "831", "832", "833", "834", "835", "836", "837", "838",
        "844", "844X"
      ),
    ],
    headsignIncludes: [
      "queanbeyan",
      "karabar",
      "jerrabomberra",
      "googong",
      "bungendore",
    ],
    providerScope: QCITY_SCOPE,
    lat: -35.3495,
    lon: 149.2357,
    radiusMeters: 2000,
  },
  // The four ACT-side places below were built from the ACT GTFS static feed
  // by scripts/build-place-routes.py. Re-run that script whenever the ACT
  // Combined Network changes (route renumbering, new interchanges, etc.).
  {
    id: "city",
    name: "Canberra City",
    routes: [
      ...acts(
        "1", "2", "3", "4", "5", "6", "7", "10",
        "31", "32",
        "50", "51", "53", "54", "55", "56", "57", "58", "59",
        "180", "181", "182",
        "X2"
      ),
      // Qcity routes that terminate at City Interchange (not in ACT GTFS)
      qcity("830"),
      qcity("837"),
      qcity("844"),
      qcity("844X"),
    ],
    // NOTE: bare "city" / "cbd" would match hundreds of Sydney headsigns.
    // Use Canberra-specific terminology only. Provider scope (below) also
    // excludes non-Qcity AnyTrip vehicles as a belt-and-braces guard.
    headsignIncludes: ["city interchange", "alinga", "civic"],
    providerScope: ACT_SCOPE,
    lat: -35.2785,
    lon: 149.13,
    radiusMeters: 800,
  },
  {
    id: "dickson",
    name: "Dickson",
    routes: [...acts("1", "9", "18", "30", "31", "50", "51", "53", "X2")],
    headsignIncludes: ["dickson"],
    providerScope: ACT_SCOPE,
    lat: -35.2502,
    lon: 149.1389,
    radiusMeters: 800,
  },
  {
    id: "gungahlin",
    name: "Gungahlin",
    routes: [
      ...acts(
        "1", "8",
        "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28",
        "X1"
      ),
    ],
    headsignIncludes: ["gungahlin"],
    providerScope: ACT_SCOPE,
    lat: -35.1853,
    lon: 149.1338,
    radiusMeters: 1200,
  },
  {
    id: "uc",
    name: "Uni of Canberra",
    routes: [
      ...acts(
        "2", "3", "4", "5", "6", "8", "9",
        "23", "24",
        "30", "31", "32",
        "41", "43", "44", "45",
        "901"
      ),
    ],
    // NOTE: we deliberately do NOT include bare "uc" here — it matches
    // "Vaucluse" and other substrings. Use full phrases only.
    headsignIncludes: [
      "university of canberra",
      "canberra college",
      "canberra institute",
    ],
    providerScope: ACT_SCOPE,
    lat: -35.238,
    lon: 149.0846,
    radiusMeters: 1200,
  },
];

export function findPlace(id: string | null): Place | null {
  if (!id) return null;
  return PLACES.find((p) => p.id === id) ?? null;
}

/**
 * Resolve a list of requested route numbers (some may be aliases like "R1")
 * to the canonical favourites configuration. Unknown numbers are returned
 * with no provider restriction so the API can still match a generic route.
 */
export function resolveRoutes(numbers: string[]): FavouriteRoute[] {
  return numbers
    .map((raw) => {
      const n = raw.trim().toLowerCase();
      if (!n) return null;
      const match = FAVOURITE_ROUTES.find(
        (r) =>
          r.number.toLowerCase() === n ||
          r.aliases?.some((a) => a.toLowerCase() === n)
      );
      if (match) return match;
      return { number: raw } satisfies FavouriteRoute;
    })
    .filter((r): r is FavouriteRoute => r !== null);
}

/** Server-side: does a vehicle satisfy any of the requested favourite routes? */
export function vehicleMatchesAny(
  vehicle: Vehicle,
  favourites: FavouriteRoute[]
): boolean {
  if (favourites.length === 0) return true;
  const short = (vehicle.routeShortName ?? vehicle.routeId ?? "").toLowerCase();
  if (!short) return false;
  return favourites.some((f) => {
    let fNum = f.number.toLowerCase();
    // Normalise AnyTrip's "R2" prefix to match our canonical "2"
    const normalise = (s: string) => s.replace(/^r(\d+)$/, "$1");
    if (normalise(fNum) !== normalise(short)) return false;
    if (f.providers && !f.providers.includes(vehicle.provider)) return false;
    if (f.agencyContains) {
      // Only enforce agency filter for providers that set the agency field.
      // Canberra GTFS-RT vehicles have agency=null, so skip the check for them.
      if (vehicle.agency != null) {
        const ag = vehicle.agency.toLowerCase();
        if (!ag.includes(f.agencyContains.toLowerCase())) return false;
      }
    }
    return true;
  });
}

/** True if the vehicle matches the given PlaceRoute spec. */
function vehicleMatchesPlaceRoute(
  vehicle: Vehicle,
  r: PlaceRoute
): boolean {
  const short = (vehicle.routeShortName ?? vehicle.routeId ?? "")
    .toLowerCase()
    .trim();
  if (!short || short !== r.number.toLowerCase()) return false;
  if (r.providers && !r.providers.includes(vehicle.provider)) return false;
  if (r.agencyContains) {
    const ag = (vehicle.agency ?? "").toLowerCase();
    if (!ag.includes(r.agencyContains.toLowerCase())) return false;
  }
  return true;
}

/** Check that a vehicle is within the place's provider scope, if any. */
function vehicleInPlaceScope(vehicle: Vehicle, place: Place): boolean {
  const scope = place.providerScope;
  if (!scope) return true;
  if (!scope.providers.includes(vehicle.provider)) return false;
  if (vehicle.provider === "anytrip" && scope.anytripAgencies?.length) {
    const ag = (vehicle.agency ?? "").toLowerCase();
    return scope.anytripAgencies.some((a) => ag.includes(a.toLowerCase()));
  }
  if (vehicle.provider === "nextthere" && scope.anytripAgencies?.length) {
    const ag = (vehicle.agency ?? "").toLowerCase();
    return scope.anytripAgencies.some((a) => ag.includes(a.toLowerCase()));
  }
  return true;
}

/**
 * Does this vehicle "belong to" the given place? A vehicle matches if EITHER:
 *   (a) its route is in the place's canonical served-route list (with the
 *       correct operator), OR
 *   (b) its live destination headsign mentions the place.
 *
 * Both paths must also satisfy the place's providerScope so that e.g. a
 * Sydney bus heading to "City" never leaks into Canberra City.
 *
 * We deliberately do NOT use current GPS proximity — a bus that happens to be
 * driving past Dickson on an unrelated route isn't "a Dickson bus".
 */
export function vehicleServesPlace(vehicle: Vehicle, place: Place): boolean {
  if (!vehicleInPlaceScope(vehicle, place)) return false;
  if (place.routes.some((r) => vehicleMatchesPlaceRoute(vehicle, r))) {
    return true;
  }
  const hs = (vehicle.headsign ?? "").toLowerCase();
  if (hs && place.headsignIncludes.some((p) => hs.includes(p.toLowerCase()))) {
    return true;
  }
  return false;
}

/**
 * Given the set of vehicles currently matched for a place, return the place's
 * canonical routes that are NOT currently live (deduplicated by number).
 * The UI uses this to show "also serves this interchange — not running right
 * now" placeholders so the user knows e.g. 844X exists even when it's off.
 */
export function dormantRoutesForPlace(
  place: Place,
  liveVehicles: Vehicle[]
): PlaceRoute[] {
  const liveNumbers = new Set(
    liveVehicles
      .map((v) =>
        (v.routeShortName ?? v.routeId ?? "").toLowerCase().trim()
      )
      .filter(Boolean)
  );
  const out: PlaceRoute[] = [];
  const seen = new Set<string>();
  for (const r of place.routes) {
    const key = r.number.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!liveNumbers.has(key)) out.push(r);
  }
  return out;
}
