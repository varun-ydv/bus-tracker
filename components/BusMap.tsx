"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import type { VehiclesResponse, Vehicle } from "@/lib/types";
import { DeparturesPanel } from "./DeparturesPanel";

const CANBERRA_CENTER: [number, number] = [-35.3075, 149.1244];

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
      : "#a855f7");
  const safeLabel = label.length > 4 ? label.slice(0, 4) : label;
  const ringStyle = highlight
    ? "box-shadow: 0 0 0 3px rgba(255,255,255,.9), 0 0 0 5px rgba(0,0,0,.4);"
    : "";
  return L.divIcon({
    html: `<div class="bus-marker" style="background:${bg};${ringStyle}">${safeLabel}</div>`,
    className: "",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
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
    const id = setInterval(fetchData, 15000);
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

export default function BusMap() {
  const [data, setData] = useState<VehiclesResponse | null>(null);
  const searchParams = useSearchParams();

  const routesParam = searchParams.get("routes");
  const placeParam = searchParams.get("place");

  // "Single-route mode" kicks in when the user has exactly one route selected
  // (and no place). Then we overlay the shape + stops for that route.
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

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (routesParam) p.set("routes", routesParam);
    if (placeParam) p.set("place", placeParam);
    return p.toString();
  }, [routesParam, placeParam]);

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
    data?.vehicles.find((v) => v.routeShortName === singleRoute)?.routeColor ??
    "#06b6d4";

  return (
    <div className="relative h-full w-full">
    <MapContainer
      center={CANBERRA_CENTER}
      zoom={11}
      className="h-full w-full"
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <AutoRefresh onData={setData} query={query} />
      <FitToBounds points={fitPoints} fitKey={fitKey} />

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

      {/* Stop dots — small circles along the route. Click to see stop name. */}
      {geometry?.stops.map((stop) => (
        <CircleMarker
          key={stop.id}
          center={[stop.lat, stop.lon]}
          radius={4}
          pathOptions={{
            color: "#0a0a0a",
            weight: 1.5,
            fillColor: "#ffffff",
            fillOpacity: 1,
          }}
        >
          <Tooltip direction="top" offset={[0, -4]} opacity={0.95}>
            {stop.name}
          </Tooltip>
        </CircleMarker>
      ))}

      {/* Live vehicles. In single-route mode we highlight them; in multi mode
          they're rendered normally. */}
      {data?.vehicles.map((v) => {
        const highlight =
          !!singleRoute &&
          (v.routeShortName === singleRoute || v.routeId === singleRoute);
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
                      : "AnyTrip")}
                  {v.label && ` · #${v.label}`}
                </div>
                {v.speed != null && (
                  <div>Speed: {(v.speed * 3.6).toFixed(0)} km/h</div>
                )}
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

    {/* Rendered outside MapContainer so Leaflet doesn't intercept scroll
        or click events on the panel itself. */}
    {singleRoute ? (
      <DeparturesPanel route={singleRoute} color={geometry?.color ?? null} />
    ) : (
      data && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-[1000] -translate-x-1/2 rounded-full bg-neutral-900/90 px-3 py-1.5 text-xs text-neutral-300 shadow-lg backdrop-blur">
          {data.vehicles.length} buses · updated{" "}
          {new Date(data.fetchedAt).toLocaleTimeString()}
        </div>
      )
    )}
    </div>
  );
}
