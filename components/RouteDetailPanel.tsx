"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Clock, History, Loader2, X, Bus } from "lucide-react";
import type { Vehicle } from "@/lib/types";

interface Departure {
  tripId: string;
  time: string;
  minutes: number;
  date: string;
  headsign: string;
  direction: number;
  terminus: string | null;
  terminusTime: string | null;
  terminusName: string | null;
  minutesFromNow: number;
  arriveTime?: string | null;
  durationMin?: number | null;
  delaySeconds?: number | null;
  live?: boolean;
}

interface DeparturesResponse {
  number: string;
  stopId: string;
  stopName: string;
  toStopId: string | null;
  toStopName: string | null;
  supportsTo: boolean;
  stops: { id: string; name: string; count: number }[];
  now: { hhmm: string; yyyymmdd: string; tz: string };
  past: Departure[];
  next: Departure[];
}

interface RouteInfo {
  number: string;
  color?: string | null;
  agency?: string | null;
}

type Tab = "vehicles" | "departures";

type DepFetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; data: DeparturesResponse }
  | { kind: "error"; message: string }
  | { kind: "unsupported" };

function fmtWait(m: number): string {
  if (m <= 0) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h ${mm}m`;
}

function fmtAge(timestamp: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function RouteDetailPanel({
  route,
  color,
  vehicles,
  onClose,
}: {
  route: RouteInfo;
  color?: string | null;
  vehicles: Vehicle[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("vehicles");
  const [depState, setDepState] = useState<DepFetchState>({ kind: "idle" });
  const [stopId, setStopId] = useState<string | null>(null);
  const [stopPickerOpen, setStopPickerOpen] = useState(false);
  const stopPickerRef = useRef<HTMLDivElement>(null);
  const tint = color ?? "#06b6d4";

  useEffect(() => {
    if (!stopPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!stopPickerRef.current?.contains(e.target as Node)) {
        setStopPickerOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [stopPickerOpen]);

  useEffect(() => {
    if (tab !== "departures") return;
    let cancelled = false;
    const run = async () => {
      setDepState((s) => (s.kind === "loaded" ? s : { kind: "loading" }));
      try {
        const params = new URLSearchParams({ number: route.number });
        if (stopId) params.set("stopId", stopId);
        const res = await fetch(`/api/route/departures?${params}`, {
          cache: "no-store",
        });
        if (res.status === 501) {
          if (!cancelled) setDepState({ kind: "unsupported" });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as DeparturesResponse;
        if (cancelled) return;
        setDepState({ kind: "loaded", data: json });
        if (!stopId) setStopId(json.stopId);
      } catch (e) {
        if (!cancelled) setDepState({ kind: "error", message: (e as Error).message });
      }
    };
    run();
    const id = setInterval(run, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tab, route.number, stopId]);

  const routeVehicles = vehicles.filter(
    (v) => v.routeShortName === route.number || v.routeId === route.number
  );

  return (
    <div className="pointer-events-auto absolute inset-y-0 left-0 z-[1000] w-[340px] max-w-[85vw] flex-col border-r border-neutral-800 bg-neutral-950/95 shadow-2xl backdrop-blur transition-transform duration-300">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-neutral-800 px-4 pt-4 pb-3">
        <span
          className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded-lg px-3 py-1.5 text-base font-bold tabular-nums text-neutral-950"
          style={{ background: tint }}
        >
          {route.number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-neutral-100">
            {routeVehicles[0]?.headsign ?? route.number}
          </div>
          {route.agency && (
            <div className="text-[11px] text-neutral-400">
              Operated by {route.agency}
            </div>
          )}
          <div className="text-[11px] text-neutral-500">
            {routeVehicles.length} vehicle{routeVehicles.length === 1 ? "" : "s"} reporting
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          aria-label="Close panel"
        >
          <X size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-800">
        <TabBtn
          active={tab === "vehicles"}
          onClick={() => setTab("vehicles")}
          label="Active vehicles"
          count={routeVehicles.length}
        />
        <TabBtn
          active={tab === "departures"}
          onClick={() => setTab("departures")}
          label="Departures"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
        {tab === "vehicles" ? (
          <VehiclesTab vehicles={routeVehicles} tint={tint} routeNumber={route.number} />
        ) : (
          <DeparturesTabContent state={depState} tint={tint} routeNumber={route.number} stopId={stopId} setStopId={setStopId} stopPickerOpen={stopPickerOpen} setStopPickerOpen={setStopPickerOpen} stopPickerRef={stopPickerRef} />
        )}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
        active
          ? "border-b-2 border-cyan-400 text-neutral-100"
          : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {label}
      {count != null && (
        <span className="ml-1.5 rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}

function VehiclesTab({
  vehicles,
  tint,
  routeNumber,
}: {
  vehicles: Vehicle[];
  tint: string;
  routeNumber: string;
}) {
  if (vehicles.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-neutral-400">
        <Bus size={24} className="text-neutral-600" />
        No active vehicles for route {routeNumber}
      </div>
    );
  }

  return (
    <div className="divide-y divide-neutral-800/60">
      {vehicles.map((v) => {
        const speedKmh = v.speed != null ? (v.speed * 3.6).toFixed(0) : null;
        return (
          <div key={`${v.provider}-${v.id}`} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-bold text-neutral-950"
                style={{ background: tint }}
              >
                {routeNumber}
              </span>
              <span className="flex-1 truncate text-sm font-medium text-neutral-100">
                {v.headsign ?? v.label ?? `Bus ${v.id}`}
              </span>
              <span className="text-[10px] text-neutral-500">
                {fmtAge(v.timestamp)}
              </span>
            </div>
            <div className="mt-1.5 text-xs text-neutral-400">
              {v.statusString ?? (
                <span className="italic text-neutral-500">En route</span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
              {speedKmh != null && <span>{speedKmh} km/h</span>}
              {v.occupancy && (
                <span>{v.occupancy.replaceAll("_", " ").toLowerCase()}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DeparturesTabContent({
  state,
  tint,
  routeNumber,
  stopId,
  setStopId,
  stopPickerOpen,
  setStopPickerOpen,
  stopPickerRef,
}: {
  state: DepFetchState;
  tint: string;
  routeNumber: string;
  stopId: string | null;
  setStopId: (id: string) => void;
  stopPickerOpen: boolean;
  setStopPickerOpen: (v: boolean) => void;
  stopPickerRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (state.kind === "unsupported") {
    return (
      <div className="px-4 py-8 text-center text-xs text-neutral-500">
        Timetable not available for this route.
      </div>
    );
  }
  if (state.kind === "idle" || state.kind === "loading") {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-xs text-neutral-400">
        <Loader2 size={14} className="animate-spin" />
        Loading timetable for {routeNumber}…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="px-4 py-8 text-xs text-red-300">
        Couldn&apos;t load timetable: {state.message}
      </div>
    );
  }

  const d = state.data;
  const firstNext = d.next[0];

  return (
    <div className="px-4 py-3">
      {/* Stop picker */}
      <div className="relative mb-3" ref={stopPickerRef}>
        <button
          onClick={() => setStopPickerOpen(!stopPickerOpen)}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-left text-xs text-neutral-300 hover:border-neutral-700"
        >
          <span className="min-w-0 truncate">
            <span className="mr-1 text-[10px] uppercase tracking-wider text-neutral-500">
              From
            </span>
            <span className="font-medium text-neutral-100">{d.stopName}</span>
          </span>
          <ChevronDown size={14} className="shrink-0 text-neutral-500" />
        </button>
        {stopPickerOpen && (
          <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[40dvh] overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/95 shadow-2xl backdrop-blur">
            {d.stops.slice(0, 200).map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    setStopId(s.id);
                    setStopPickerOpen(false);
                  }}
                  className={`block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-neutral-900 ${
                    s.id === d.stopId
                      ? "bg-neutral-900 text-cyan-300"
                      : "text-neutral-300"
                  }`}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Quick next summary */}
      {firstNext && (
        <div className="mb-3 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs">
          <span className="text-neutral-400">Next </span>
          <span className="font-mono font-medium text-neutral-100">
            {firstNext.time}
          </span>
          <span className="text-neutral-400"> · in </span>
          <span style={{ color: tint }} className="font-medium">
            {fmtWait(firstNext.minutesFromNow)}
          </span>
        </div>
      )}

      {/* Past departures */}
      {d.past.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
            <History size={10} />
            Earlier
          </div>
          <ul className="space-y-0.5">
            {d.past.map((dep) => (
              <DepRow key={dep.tripId + dep.date} dep={dep} past tint={tint} />
            ))}
          </ul>
        </div>
      )}

      {/* Next departures */}
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
          <Clock size={10} />
          Upcoming
        </div>
        {d.next.length === 0 ? (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs text-neutral-500">
            No more trips scheduled today.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {d.next.map((dep) => (
              <DepRow key={dep.tripId + dep.date} dep={dep} tint={tint} />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2 text-[10px] text-neutral-600">
        Scheduled times · as of {d.now.hhmm}
      </div>
    </div>
  );
}

function DepRow({
  dep,
  past,
  tint,
}: {
  dep: Departure;
  past?: boolean;
  tint: string;
}) {
  return (
    <li
      className={`flex items-center gap-3 rounded-lg px-2 py-1.5 ${
        past ? "text-neutral-500" : "bg-neutral-900/50 text-neutral-100"
      }`}
    >
      <span className="w-11 shrink-0 font-mono text-sm tabular-nums">
        {dep.time}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs">
        → {dep.headsign || dep.terminusName || "—"}
      </span>
      <span
        className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
        style={
          past
            ? { background: "#171717", color: "#737373" }
            : { background: `${tint}22`, color: tint }
        }
      >
        {past
          ? `-${fmtWait(-dep.minutesFromNow)}`
          : dep.minutesFromNow === 0
          ? "now"
          : `+${fmtWait(dep.minutesFromNow)}`}
      </span>
    </li>
  );
}
