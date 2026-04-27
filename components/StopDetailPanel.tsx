"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BusFront, ChevronDown, Clock, Loader2, X } from "lucide-react";
import type { RouteStop } from "@/lib/routes";
import type { TimingProvider } from "@/lib/types";
import { PoweredByTransit } from "./PoweredByTransit";

interface Departure {
  tripId: string;
  routeNumber: string;
  routeColor?: string | null;
  routeLongName?: string | null;
  time: string;
  date: string;
  headsign: string;
  minutesFromNow: number;
  delaySeconds?: number | null;
  live?: boolean;
}

interface DeparturesResponse {
  stopId: string;
  stopName: string;
  source?: { provider: TimingProvider; label: string };
  now: { hhmm: string; yyyymmdd: string; tz: string };
  departures: Departure[];
}

type FetchState =
  | { kind: "loading" }
  | { kind: "loaded"; data: DeparturesResponse }
  | { kind: "error"; message: string }
  | { kind: "unsupported" };

const TIMING_SOURCES: Array<{ id: TimingProvider; label: string }> = [
  { id: "auto", label: "Auto" },
  { id: "canberra", label: "ACT" },
  { id: "nsw", label: "NSW" },
  { id: "anytrip", label: "AnyTrip" },
  { id: "nextthere", label: "NextThere" },
  { id: "transit", label: "Transit" },
];

function fmtWait(minutes: number): string {
  if (minutes <= 0) return "now";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function fmtDelay(delaySeconds: number | null | undefined) {
  if (delaySeconds == null) return null;
  const minutes = Math.round(delaySeconds / 60);
  if (Math.abs(minutes) < 1) {
    return { text: "on time", color: "text-emerald-400" };
  }
  if (minutes > 0) {
    return { text: `${minutes} min late`, color: "text-amber-400" };
  }
  return { text: `${Math.abs(minutes)} min early`, color: "text-sky-400" };
}

export function StopDetailPanel({
  routeNumber,
  stop,
  color,
  timingProvider,
  onTimingProviderChange,
  onSelectRoute,
  onBack,
  onClose,
}: {
  routeNumber: string;
  stop: RouteStop;
  color?: string | null;
  timingProvider: TimingProvider;
  onTimingProviderChange: (provider: TimingProvider) => void;
  onSelectRoute: (routeNumber: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<FetchState>({ kind: "loading" });
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceRef = useRef<HTMLDivElement>(null);
  const tint = color ?? "#06b6d4";

  useEffect(() => {
    if (!sourceOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!sourceRef.current?.contains(event.target as Node)) {
        setSourceOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [sourceOpen]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setState((current) =>
        current.kind === "loaded" ? current : { kind: "loading" }
      );
      try {
        const params = new URLSearchParams({
          route: routeNumber,
          stopId: stop.id,
          provider: timingProvider,
          next: "25",
        });
        const res = await fetch(`/api/stop/departures?${params}`, {
          cache: "no-store",
        });
        if (res.status === 501) {
          if (!cancelled) setState({ kind: "unsupported" });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as DeparturesResponse;
        if (!cancelled) setState({ kind: "loaded", data });
      } catch (error) {
        if (!cancelled) setState({ kind: "error", message: (error as Error).message });
      }
    };

    run();
    const interval = setInterval(run, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [routeNumber, stop.id, timingProvider]);

  const selectedSource =
    TIMING_SOURCES.find((source) => source.id === timingProvider) ??
    TIMING_SOURCES[0];
  const departures = state.kind === "loaded" ? state.data.departures : [];

  return (
    <aside className="pointer-events-auto absolute inset-y-0 left-0 z-[1000] flex w-[360px] max-w-[88vw] flex-col border-r border-neutral-800 bg-neutral-950/96 text-neutral-100 shadow-2xl backdrop-blur">
      <header className="border-b border-neutral-800 px-4 pb-3 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-medium text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
          >
            <ArrowLeft size={15} />
            Route
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
            aria-label="Close stop details"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-[3.25rem,1fr] gap-x-3 gap-y-1 text-sm">
          <div className="text-right text-xs font-semibold text-neutral-500">From:</div>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-neutral-100">
              {stop.name}
            </div>
            <div className="truncate text-xs text-neutral-500">{stop.id}</div>
          </div>
          <div className="text-right text-xs font-semibold text-neutral-500">To:</div>
          <div className="text-sm text-neutral-300">All destinations</div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-neutral-950"
            style={{ background: tint }}
          >
            <BusFront size={18} />
          </span>
          <div className="relative min-w-0 flex-1" ref={sourceRef}>
            <button
              onClick={() => setSourceOpen((open) => !open)}
              className="flex w-full items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-left text-xs text-neutral-300 hover:border-neutral-700"
            >
              <span className="truncate">
                Timing: <span className="text-neutral-100">{selectedSource.label}</span>
              </span>
              <ChevronDown
                size={14}
                className={`shrink-0 text-neutral-500 transition ${
                  sourceOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {sourceOpen && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl">
                {TIMING_SOURCES.map((source) => (
                  <button
                    key={source.id}
                    onClick={() => {
                      onTimingProviderChange(source.id);
                      setSourceOpen(false);
                    }}
                    className={`block w-full px-3 py-2 text-left text-xs ${
                      source.id === timingProvider
                        ? "bg-neutral-900 text-cyan-300"
                        : "text-neutral-300 hover:bg-neutral-900"
                    }`}
                  >
                    {source.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {timingProvider === "transit" && (
          <div className="mt-2">
            <PoweredByTransit />
          </div>
        )}
      </header>

      <div className="border-b border-neutral-800 bg-neutral-900/40 px-4 py-2 text-xs text-neutral-400">
        {state.kind === "loaded" ? (
          <>
            {state.data.source?.label ?? selectedSource.label} · refreshes every 30s ·
            updated {state.data.now.hhmm}
          </>
        ) : state.kind === "loading" ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" />
            Loading departures
          </span>
        ) : state.kind === "unsupported" ? (
          "This timing source cannot show departures here"
        ) : (
          `Could not load departures: ${state.message}`
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.kind === "loaded" && departures.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-neutral-500">
            No upcoming departures from this stop.
          </div>
        )}

        {state.kind === "unsupported" && (
          <div className="px-4 py-8 text-center text-sm text-neutral-500">
            Try Auto, AnyTrip, ACT, or Transit for this route.
          </div>
        )}

        {state.kind === "error" && (
          <div className="px-4 py-8 text-sm text-red-300">{state.message}</div>
        )}

        {state.kind === "loaded" && departures.length > 0 && (
          <div className="divide-y divide-neutral-800/70">
            {departures.map((departure) => {
              const delay = fmtDelay(departure.delaySeconds);
              const routeColor = departure.routeColor ?? tint;
              return (
                <button
                  key={`${departure.tripId}:${departure.date}:${departure.time}`}
                  onClick={() => onSelectRoute(departure.routeNumber)}
                  className="grid w-full grid-cols-[auto,1fr,auto] gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-900/70"
                >
                  <span
                    className="mt-0.5 inline-flex h-6 min-w-9 items-center justify-center rounded px-1.5 text-xs font-bold text-neutral-950"
                    style={{ background: routeColor }}
                  >
                    {departure.routeNumber}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-neutral-100">
                      {departure.headsign || "All destinations"}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-neutral-500">
                      {departure.routeLongName ?? (departure.live ? "real-time" : "timetabled")}
                      {delay && <span className={`ml-2 ${delay.color}`}>{delay.text}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-semibold tabular-nums text-neutral-100">
                      {fmtWait(departure.minutesFromNow)}
                    </div>
                    <div className="inline-flex items-center gap-1 text-xs tabular-nums text-neutral-500">
                      <Clock size={11} />
                      {departure.time}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
