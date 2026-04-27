"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { TimingProvider, VehiclesResponse, Vehicle } from "@/lib/types";
import { RouteDetailPanel } from "./RouteDetailPanel";
import { StopDetailPanel } from "./StopDetailPanel";
import type { RouteStop } from "@/lib/routes";

const CANBERRA_CENTER: [number, number] = [-35.3075, 149.1244];

type Basemap = "osm" | "satellite" | "hybrid" | "terrain";

const BASEMAP_TILES: Record<Basemap, { url: string; attribution: string; subdomains: string[] }> = {
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    subdomains: ["a", "b", "c"],
  },
  satellite: {
    url: "https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    attribution: "&copy; Google Maps",
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
  },
  hybrid: {
    url: "https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    attribution: "&copy; Google Maps",
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
  },
  terrain: {
    url: "https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}",
    attribution: "&copy; Google Maps",
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
  },
};

const BASEMAP_LABELS: Record<Basemap, string> = {
  osm: "Map",
  satellite: "Satellite",
  hybrid: "Hybrid",
  terrain: "Terrain",
};

const BASEMAP_ORDER: Basemap[] = ["osm", "satellite", "hybrid", "terrain"];
const TIMING_PROVIDERS = new Set<TimingProvider>([
  "auto",
  "canberra",
  "nsw",
  "anytrip",
  "nextthere",
  "transit",
]);

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";

function usePersistedBasemap(): [Basemap, (b: Basemap) => void] {
  const [basemap, setBasemap] = useState<Basemap>(() => {
    if (typeof window === "undefined") return "osm";
    try {
      const stored = localStorage.getItem("bus-tracker:basemap") as Basemap | null;
      if (stored && stored in BASEMAP_TILES) return stored;
    } catch {}
    return "osm";
  });

  const set = (b: Basemap) => {
    setBasemap(b);
    try {
      localStorage.setItem("bus-tracker:basemap", b);
    } catch {}
  };

  return [basemap, set];
}

interface RouteGeometry {
  number: string;
  color?: string | null;
  agency?: string | null;
  shapes: { points: [number, number][] }[];
  stops: { id: string; name: string; lat: number; lon: number }[];
}

function makeBusIcon(label: string, vehicle: Vehicle, highlight: boolean) {
  const bg =
    vehicle.routeColor ??
    (vehicle.provider === "canberra"
      ? "#06b6d4"
      : vehicle.provider === "nsw"
      ? "#f97316"
      : vehicle.provider === "nextthere"
      ? "#10b981"
      : vehicle.provider === "transit"
      ? "#3b82f6"
      : "#a855f7");
  const safeLabel = label.length > 4 ? label.slice(0, 4) : label;
  const bearing = typeof vehicle.bearing === "number" ? vehicle.bearing : 0;

  const delay = vehicle.delay ?? null;
  let delayBadge = "";
  if (delay != null) {
    const m = Math.round(delay / 60);
    if (Math.abs(m) < 1) {
      delayBadge = `<span class="bus-delay on-time">on time</span>`;
    } else if (m > 0) {
      delayBadge = `<span class="bus-delay late">${m}m</span>`;
    } else {
      delayBadge = `<span class="bus-delay early">${Math.abs(m)}m</span>`;
    }
  }

  const ring = highlight ? "box-shadow: 0 0 0 3px rgba(255,255,255,.9), 0 0 0 5px rgba(0,0,0,.4);" : "";

  return L.divIcon({
    html: `<div class="bus-wrap" style="${ring}">
      <div class="bus-marker" style="background:${bg}">
        <span class="bus-label">${safeLabel}</span>
        <div class="bus-tail" style="border-bottom-color:${bg};transform:rotate(${bearing}deg)"></div>
      </div>
      ${delayBadge}
    </div>`,
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function AutoRefresh({
  onData,
  query,
}: {
  onData: (d: VehiclesResponse) => void;
  query: string;
}) {
  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/vehicles${query ? `?${query}` : ""}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json: VehiclesResponse = await res.json();
        if (!cancelled) onData(json);
      } catch {
        // ignore
      }
    };
    fetchData();
    const id = setInterval(fetchData, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [onData, query]);
  return null;
}

function FitToBounds({
  points,
  fitKey,
}: {
  points: [number, number][];
  fitKey: string;
}) {
  const map = useMap();
  const [lastKey, setLastKey] = useState<string | null>(null);

  useEffect(() => {
    if (points.length === 0) return;
    if (lastKey === fitKey) return;
    const bounds = L.latLngBounds(points);
    if (!bounds.isValid()) return;
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    setLastKey(fitKey);
  }, [points, map, fitKey, lastKey]);

  return null;
}

function CloseOnMapClick({ onClose }: { onClose: () => void }) {
  const map = useMap();
  useEffect(() => {
    map.on("click", onClose);
    return () => {
      map.off("click", onClose);
    };
  }, [map, onClose]);
  return null;
}

/**
 * When exactly one route is selected in the URL, fetch its shape + stops and
 * draw the polyline + stop dots (AnyTrip-style).
 */
function useRouteGeometry(routeNumber: string | null) {
  const [geo, setGeo] = useState<RouteGeometry | null>(null);

  useEffect(() => {
    if (!routeNumber) {
      setGeo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/route?number=${encodeURIComponent(routeNumber)}`,
          { cache: "force-cache" }
        );
        if (!res.ok) {
          if (!cancelled) setGeo(null);
          return;
        }
        const json = (await res.json()) as RouteGeometry;
        if (!cancelled) setGeo(json);
      } catch {
        if (!cancelled) setGeo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeNumber]);

  return geo;
}

function CaptureMap({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
  }, [map, mapRef]);
  return null;
}

interface ServiceAlert {
  id: string;
  header: string;
  description?: string;
  routeGroups?: string[];
  url?: string;
}

function useServiceAlerts() {
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);
  useEffect(() => {
    let cancelled = false;
    const fetchAlerts = async () => {
      try {
        const res = await fetch("/api/alerts", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { alerts: ServiceAlert[] };
        if (!cancelled) setAlerts(json.alerts ?? []);
      } catch {}
    };
    fetchAlerts();
    const id = setInterval(fetchAlerts, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return alerts;
}

function AlertsPanel({
  alerts,
  selectedRoute,
  onClose,
}: {
  alerts: ServiceAlert[];
  selectedRoute: string | null;
  onClose: () => void;
}) {
  const normalise = (s: string) => s.replace(/^r(\d+)$/i, "$1");
  const normalisedRoute = selectedRoute ? normalise(selectedRoute) : null;

  const isRelevant = (alert: ServiceAlert) => {
    if (!normalisedRoute || !alert.routeGroups?.length) return false;
    return alert.routeGroups.some((rg) => {
      const parts = rg.split(":");
      const name = parts[parts.length - 1];
      return normalise(name) === normalisedRoute;
    });
  };

  const sorted = useMemo(() => {
    return [...alerts].sort((a, b) => {
      const aRel = isRelevant(a) ? 0 : 1;
      const bRel = isRelevant(b) ? 0 : 1;
      return aRel - bRel;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts, normalisedRoute]);

  return (
    <div className="absolute inset-y-0 right-0 z-[1100] w-[340px] max-w-[85vw] flex flex-col border-l border-neutral-800 bg-neutral-950/95 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <AlertTriangle size={16} className="text-amber-400" />
        <span className="text-sm font-semibold text-neutral-100">
          Service Alerts
        </span>
        <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-medium text-amber-400">
          {alerts.length}
        </span>
        <button
          onClick={onClose}
          className="ml-auto rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          aria-label="Close alerts"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-2">
        {sorted.length === 0 ? (
          <div className="py-8 text-center text-xs text-neutral-500">
            No active alerts
          </div>
        ) : (
          sorted.map((alert) => {
            const relevant = isRelevant(alert);
            return (
              <div
                key={alert.id}
                className={`rounded-xl border p-3 ${
                  relevant
                    ? "border-amber-500/40 bg-amber-950/20"
                    : "border-neutral-800 bg-neutral-900/60"
                }`}
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    size={14}
                    className={`mt-0.5 shrink-0 ${
                      relevant ? "text-amber-400" : "text-neutral-500"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-neutral-100">
                      {alert.header}
                    </div>
                    {alert.description && (
                      <div className="mt-1 text-[11px] leading-relaxed text-neutral-400">
                        {alert.description}
                      </div>
                    )}
                    {alert.url && (
                      <a
                        href={alert.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-block text-[11px] text-cyan-400 hover:underline"
                      >
                        More info
                      </a>
                    )}
                    {relevant && (
                      <span className="mt-1.5 inline-block rounded-full bg-amber-400/20 px-2 py-0.5 text-[9px] font-medium text-amber-400">
                        Affects your route
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function BusMap() {
  const router = useRouter();
  const [data, setData] = useState<VehiclesResponse | null>(null);
  const [basemap, setBasemap] = usePersistedBasemap();
  const [basemapOpen, setBasemapOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const searchParams = useSearchParams();

  const alerts = useServiceAlerts();

  const routesParam = searchParams.get("routes");
  const placeParam = searchParams.get("place");
  const providerParam = searchParams.get("provider");
  const timingParam = searchParams.get("timing");

  const singleRoute = useMemo(() => {
    if (placeParam) return null;
    if (!routesParam) return null;
    const list = routesParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length !== 1) return null;
    return list[0];
  }, [routesParam, placeParam]);

  const [panelOpen, setPanelOpen] = useState(!!singleRoute);
  const [selectedStop, setSelectedStop] = useState<RouteStop | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (routesParam) p.set("routes", routesParam);
    if (placeParam) p.set("place", placeParam);
    if (providerParam) p.set("provider", providerParam);
    return p.toString();
  }, [routesParam, placeParam, providerParam]);

  const [timingProvider, setTimingProviderState] = useState<TimingProvider>(() => {
    if (typeof window === "undefined") return "auto";
    try {
      const stored = localStorage.getItem("bus-tracker:timing-provider");
      if (stored && TIMING_PROVIDERS.has(stored as TimingProvider)) {
        return stored as TimingProvider;
      }
    } catch {}
    return "auto";
  });

  useEffect(() => {
    if (timingParam && TIMING_PROVIDERS.has(timingParam as TimingProvider)) {
      setTimingProviderState(timingParam as TimingProvider);
    }
  }, [timingParam]);

  const setTimingProvider = useCallback(
    (provider: TimingProvider) => {
      setTimingProviderState(provider);
      try {
        localStorage.setItem("bus-tracker:timing-provider", provider);
      } catch {}
      const params = new URLSearchParams(searchParams.toString());
      if (provider === "auto") params.delete("timing");
      else params.set("timing", provider);
      const qs = params.toString();
      router.replace(qs ? `/map?${qs}` : "/map", { scroll: false });
    },
    [router, searchParams]
  );

  const geometry = useRouteGeometry(singleRoute);

  // Priority order for map auto-fit:
  //   1. If a single-route overlay is loaded → fit the whole route shape.
  //   2. Otherwise fit to live vehicles.
  const fitPoints: [number, number][] = useMemo(() => {
    if (geometry) {
      const pts: [number, number][] = [];
      for (const s of geometry.shapes) pts.push(...s.points);
      if (pts.length) return pts;
    }
    return (data?.vehicles ?? []).map((v) => [v.lat, v.lon]);
  }, [geometry, data]);

  const fitKey = geometry ? `route:${singleRoute}` : `filter:${query}`;

  const highlightColor =
    geometry?.color ??
    data?.vehicles.find((v) => {
      const normalise = (s: string) => s.replace(/^r(\d+)$/i, "$1");
      return normalise(v.routeShortName ?? v.routeId ?? "") === normalise(singleRoute ?? "");
    })?.routeColor ??
    "#06b6d4";

  const closeBasemap = useCallback(() => setBasemapOpen(false), []);

  return (
    <div className="relative h-full w-full">
    <MapContainer
      center={CANBERRA_CENTER}
      zoom={11}
      className="h-full w-full"
      zoomControl={false}
    >
      <TileLayer
        key={basemap}
        attribution={BASEMAP_TILES[basemap].attribution}
        url={
          basemap === "osm"
            ? BASEMAP_TILES[basemap].url
            : BASEMAP_TILES[basemap].url +
              (GOOGLE_KEY ? `&key=${GOOGLE_KEY}` : "")
        }
        subdomains={BASEMAP_TILES[basemap].subdomains}
      />

      <AutoRefresh onData={setData} query={query} />
      <FitToBounds points={fitPoints} fitKey={fitKey} />
      <CaptureMap mapRef={mapRef} />
      <CloseOnMapClick onClose={() => { closeBasemap(); setSelectedStop(null); }} />

      {/* Route shape — a thick coloured line with a dark halo underneath for
          contrast against the basemap. Rendered before markers so bus icons
          stay on top. */}
      {geometry?.shapes.map((s, i) => (
        <Polyline
          key={`halo-${i}`}
          positions={s.points}
          pathOptions={{
            color: "#000",
            weight: 8,
            opacity: 0.25,
            lineCap: "round",
          }}
        />
      ))}
      {geometry?.shapes.map((s, i) => (
        <Polyline
          key={`line-${i}`}
          positions={s.points}
          pathOptions={{
            color: highlightColor,
            weight: 5,
            opacity: 0.95,
            lineCap: "round",
          }}
        />
      ))}

      {/* Stop dots — tappable circles along the route. Click to see stop details. */}
      {geometry?.stops.map((stop) => {
        const isSelected = selectedStop?.id === stop.id;
        return (
          <Fragment key={stop.id}>
            {/* Invisible larger hit area for easier tapping */}
            <CircleMarker
              center={[stop.lat, stop.lon]}
              radius={14}
              pathOptions={{
                color: "transparent",
                weight: 0,
                fillColor: "transparent",
                fillOpacity: 0,
                interactive: true,
                bubblingMouseEvents: false,
              }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  setSelectedStop({ id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon });
                },
              }}
            />
            {/* Visible stop dot */}
            <CircleMarker
              center={[stop.lat, stop.lon]}
              radius={isSelected ? 9 : 6}
              pathOptions={{
                color: isSelected ? highlightColor : "#334155",
                weight: isSelected ? 3 : 2,
                fillColor: isSelected ? highlightColor : "#ffffff",
                fillOpacity: 1,
                className: "cursor-pointer",
              }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  setSelectedStop({ id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon });
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                {stop.name}
              </Tooltip>
            </CircleMarker>
          </Fragment>
        );
      })}

      {/* Live vehicles. In single-route mode we highlight them; in multi mode
          they're rendered normally. */}
      {data?.vehicles.map((v) => {
        const normalise = (s: string) => s.replace(/^r(\d+)$/i, "$1");
        const vRoute = normalise(v.routeShortName ?? v.routeId ?? "");
        const highlight =
          !!singleRoute &&
          (vRoute === normalise(singleRoute));
        return (
          <Marker
            key={`${v.provider}-${v.id}`}
            position={[v.lat, v.lon]}
            icon={makeBusIcon(
              v.routeShortName ?? v.routeId ?? v.label ?? "?",
              v,
              highlight
            )}
            zIndexOffset={highlight ? 1000 : 0}
          >
            <Popup>
              <div className="text-xs">
                <div className="text-sm font-bold">
                  Route {v.routeShortName ?? v.routeId ?? "?"}
                  {v.headsign && (
                    <span className="ml-1 font-normal text-neutral-600">
                      → {v.headsign}
                    </span>
                  )}
                </div>
                <div className="text-neutral-700">
                  {v.agency ??
                    (v.provider === "canberra"
                      ? "Transport Canberra"
                      : v.provider === "nsw"
                      ? "Transport NSW"
                      : v.provider === "nextthere"
                      ? "NextThere"
                      : v.provider === "transit"
                      ? "Transit App"
                      : "AnyTrip")}
                  {v.label && ` · #${v.label}`}
                </div>
                {v.delay != null && (
                  <div className={v.delay > 120 ? "text-amber-600" : v.delay < -30 ? "text-blue-600" : "text-green-600"}>
                    {Math.abs(v.delay) < 30 ? "On time" : v.delay > 0 ? `${Math.round(v.delay / 60)} min late` : `${Math.round(Math.abs(v.delay) / 60)} min early`}
                  </div>
                )}
                {v.speed != null && (
                  <div>Speed: {(v.speed * 3.6).toFixed(0)} km/h</div>
                )}
                {v.occupancy && (() => {
                  const o = v.occupancy.toUpperCase();
                  let occColor = "#22c55e";
                  if (o === "FEW_SEATS_AVAILABLE") occColor = "#eab308";
                  else if (o === "STANDING_ROOM_ONLY") occColor = "#f97316";
                  else if (o === "CRUSHED_STANDING_ROOM_ONLY" || o === "FULL" || o === "NOT_ACCEPTING_PASSENGERS") occColor = "#ef4444";
                  return (
                    <div style={{ color: occColor }}>
                      Occupancy: {v.occupancy.replaceAll("_", " ").toLowerCase()}
                    </div>
                  );
                })()}
                {v.statusString && (
                  <div className="mt-1 italic text-neutral-600">
                    {v.statusString}
                  </div>
                )}
                <div className="mt-1 text-neutral-500">
                  Updated {new Date(v.timestamp * 1000).toLocaleTimeString()}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}

    </MapContainer>

    {/* Alert bell — top-right floating button */}
    <div className="absolute top-3 right-3 z-[1000]">
      <button
        onClick={() => setAlertsOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900/90 text-neutral-300 shadow-lg backdrop-blur hover:bg-neutral-800 hover:text-white"
        title="Service alerts"
      >
        <AlertTriangle size={16} />
        {alerts.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-neutral-950">
            {alerts.length > 9 ? "9+" : alerts.length}
          </span>
        )}
      </button>
    </div>

    {/* Alerts side panel */}
    {alertsOpen && (
      <AlertsPanel
        alerts={alerts}
        selectedRoute={singleRoute}
        onClose={() => setAlertsOpen(false)}
      />
    )}

    {/* Basemap layer picker — bottom-right floating button */}
    <div className="absolute bottom-3 right-3 z-[1000] flex flex-col items-end gap-1.5">
      {basemapOpen && (
        <div className="flex flex-col gap-1 rounded-xl bg-neutral-900/90 p-1.5 shadow-lg backdrop-blur">
          {BASEMAP_ORDER.map((b) => (
            <button
              key={b}
              onClick={() => {
                setBasemap(b);
                setBasemapOpen(false);
              }}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                basemap === b
                  ? "bg-white text-neutral-900"
                  : "text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              {BASEMAP_LABELS[b]}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => setBasemapOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900/90 text-neutral-300 shadow-lg backdrop-blur hover:bg-neutral-800 hover:text-white"
        title="Change basemap"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
      </button>
    </div>

    {/* Route detail side panel */}
    {singleRoute && data && panelOpen && !selectedStop && (
      <RouteDetailPanel
        route={{
          number: singleRoute,
          color: geometry?.color ?? null,
          agency: geometry?.agency ?? null,
        }}
        color={geometry?.color ?? null}
        vehicles={data.vehicles}
        onClose={() => setPanelOpen(false)}
        onFocusVehicle={(v) => {
          mapRef.current?.flyTo([v.lat, v.lon], 15, { duration: 0.8 });
        }}
        stops={geometry?.stops}
        timingProvider={timingProvider}
        onTimingProviderChange={setTimingProvider}
      />
    )}

    {/* Stop detail side panel */}
    {singleRoute && selectedStop && (
      <StopDetailPanel
        routeNumber={singleRoute}
        stop={selectedStop}
        color={geometry?.color ?? null}
        timingProvider={timingProvider}
        onTimingProviderChange={setTimingProvider}
        onSelectRoute={(routeNumber) => {
          setSelectedStop(null);
          const params = new URLSearchParams(searchParams.toString());
          params.set("routes", routeNumber);
          router.replace(`/map?${params.toString()}`, { scroll: false });
        }}
        onBack={() => setSelectedStop(null)}
        onClose={() => setSelectedStop(null)}
      />
    )}

    {/* Bottom bar */}
    {singleRoute && !panelOpen && (
      <button
        onClick={() => setPanelOpen(true)}
        className="pointer-events-auto absolute bottom-3 left-3 right-3 z-[1000] mx-auto max-w-md rounded-2xl border border-neutral-800 bg-neutral-950/95 px-4 py-2.5 text-left shadow-2xl backdrop-blur"
      >
        <span className="text-xs text-neutral-300">
          Tap for route details & departures
        </span>
      </button>
    )}
    {!singleRoute && data && (
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-[1000] -translate-x-1/2 rounded-full bg-neutral-900/90 px-3 py-1.5 text-xs text-neutral-300 shadow-lg backdrop-blur">
        {data.vehicles.length} buses · updated{" "}
        {new Date(data.fetchedAt).toLocaleTimeString()}
      </div>
    )}
    </div>
  );
}
