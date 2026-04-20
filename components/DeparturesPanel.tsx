"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Clock, History, Loader2 } from "lucide-react";

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

type FetchState =
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

/**
 * Bottom-anchored pill/sheet showing "previous 3 / next 5" scheduled trips
 * for the selected route at a chosen stop. Shown only in single-route mode.
 */
export function DeparturesPanel({
  route,
  color,
}: {
  route: string;
  color?: string | null;
}) {
  const [stopId, setStopId] = useState<string | null>(null);
  const [toStopId, setToStopId] = useState<string | null>(null);
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [expanded, setExpanded] = useState(false);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  const fromRef = useRef<HTMLDivElement>(null);
  const toRef = useRef<HTMLDivElement>(null);

  // Close pickers when clicking outside either of them.
  useEffect(() => {
    if (!fromOpen && !toOpen) return;
    const onDown = (e: MouseEvent) => {
      if (fromOpen && !fromRef.current?.contains(e.target as Node)) {
        setFromOpen(false);
      }
      if (toOpen && !toRef.current?.contains(e.target as Node)) {
        setToOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [fromOpen, toOpen]);

  // Reset "To" whenever the route changes (stops may differ entirely).
  useEffect(() => {
    setToStopId(null);
  }, [route]);

  // Fetch departures whenever route, stopId, or toStopId changes, and every 30s.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setState((s) =>
        s.kind === "loaded" ? s : { kind: "loading" }
      );
      try {
        const params = new URLSearchParams({ number: route });
        if (stopId) params.set("stopId", stopId);
        if (toStopId) params.set("toStopId", toStopId);
        const res = await fetch(`/api/route/departures?${params}`, {
          cache: "no-store",
        });
        if (res.status === 501) {
          if (!cancelled) setState({ kind: "unsupported" });
          return;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as DeparturesResponse;
        if (cancelled) return;
        setState({ kind: "loaded", data: json });
        if (!stopId) setStopId(json.stopId);
      } catch (e) {
        if (!cancelled) {
          setState({ kind: "error", message: (e as Error).message });
        }
      }
    };
    run();
    const id = setInterval(run, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [route, stopId, toStopId]);

  const tint = color ?? "#06b6d4";

  if (state.kind === "unsupported") return null;
  if (state.kind === "idle" || state.kind === "loading") {
    return (
      <div className="pointer-events-auto absolute bottom-3 left-3 right-3 z-[1000] mx-auto flex max-w-md items-center gap-2 rounded-2xl border border-neutral-800 bg-neutral-950/90 px-4 py-2.5 text-xs text-neutral-400 shadow-2xl backdrop-blur">
        <Loader2 size={14} className="animate-spin" />
        Loading timetable for {route}…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="pointer-events-auto absolute bottom-3 left-3 right-3 z-[1000] mx-auto max-w-md rounded-2xl border border-red-900/50 bg-red-950/70 px-4 py-2.5 text-xs text-red-200 shadow-2xl backdrop-blur">
        Couldn’t load timetable: {state.message}
      </div>
    );
  }

  const d = state.data;
  const firstNext = d.next[0];
  const lastPast = d.past[d.past.length - 1];

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 right-3 z-[1000] mx-auto max-w-md rounded-2xl border border-neutral-800 bg-neutral-950/95 text-neutral-100 shadow-2xl backdrop-blur">
      {/* Compact header: route + next bus */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
        aria-label={expanded ? "Collapse timetable" : "Expand timetable"}
      >
        <span
          className="inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-bold tabular-nums text-neutral-950"
          style={{ background: tint }}
        >
          {d.number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-neutral-200">
            {d.stopName}
            {d.toStopName && (
              <span className="text-neutral-500"> → {d.toStopName}</span>
            )}
          </div>
          <div className="text-[11px] text-neutral-400">
            {firstNext
              ? `Next ${firstNext.time}${
                  d.toStopId && firstNext.arriveTime
                    ? ` → ${firstNext.arriveTime}`
                    : ""
                } · in ${fmtWait(firstNext.minutesFromNow)}`
              : lastPast
              ? `Last ran ${lastPast.time} · ${fmtWait(-lastPast.minutesFromNow)} ago`
              : "No more services today"}
          </div>
        </div>
        <ChevronDown
          size={16}
          className={`shrink-0 text-neutral-400 transition ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded && (
        <div className="border-t border-neutral-800 p-3 pt-2">
          {/* From/To pickers. "To" is hidden for providers that can't answer
              "will this trip reach stop Y?" (AnyTrip stop-keyed feed). */}
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <StopPicker
              label="From"
              value={d.stopName}
              open={fromOpen}
              setOpen={setFromOpen}
              containerRef={fromRef}
              stops={d.stops}
              selectedId={d.stopId}
              disabledId={d.toStopId}
              onPick={(id) => {
                setStopId(id);
                setFromOpen(false);
              }}
            />
            {d.supportsTo && (
              <StopPicker
                label="To"
                value={d.toStopName ?? "Any stop"}
                open={toOpen}
                setOpen={setToOpen}
                containerRef={toRef}
                stops={d.stops}
                selectedId={d.toStopId}
                disabledId={d.stopId}
                clearable
                onPick={(id) => {
                  setToStopId(id);
                  setToOpen(false);
                }}
                onClear={() => {
                  setToStopId(null);
                  setToOpen(false);
                }}
              />
            )}
          </div>

          {/* Past departures */}
          {d.past.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                <History size={10} />
                Earlier
              </div>
              <ul className="space-y-0.5">
                {d.past.map((dep) => (
                  <DepartureRow
                    key={dep.tripId + dep.date}
                    dep={dep}
                    past
                    showArrival={!!d.toStopId}
                  />
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
                {d.toStopId
                  ? "No more trips today from this stop to your destination."
                  : "No more trips scheduled today."}
              </div>
            ) : (
              <ul className="space-y-0.5">
                {d.next.map((dep) => (
                  <DepartureRow
                    key={dep.tripId + dep.date}
                    dep={dep}
                    showArrival={!!d.toStopId}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="mt-2 text-[10px] text-neutral-600">
            Scheduled times · Australia/Sydney · as of {d.now.hhmm}
          </div>
        </div>
      )}
    </div>
  );
}

function DepartureRow({
  dep,
  past,
  showArrival,
}: {
  dep: Departure;
  past?: boolean;
  showArrival?: boolean;
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
      {showArrival && dep.arriveTime ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
          <span className="text-neutral-500">→</span>
          <span className="font-mono tabular-nums">{dep.arriveTime}</span>
          {dep.durationMin != null && dep.durationMin > 0 && (
            <span className="shrink-0 text-[10px] text-neutral-500">
              · {fmtWait(dep.durationMin)}
            </span>
          )}
          <span className="min-w-0 truncate text-[11px] text-neutral-500">
            {dep.headsign || dep.terminusName || ""}
          </span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-xs">
          → {dep.headsign || dep.terminusName || "—"}
        </span>
      )}
      <span
        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
          past
            ? "bg-neutral-900 text-neutral-500"
            : "bg-cyan-500/15 text-cyan-300"
        }`}
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

function StopPicker({
  label,
  value,
  open,
  setOpen,
  containerRef,
  stops,
  selectedId,
  disabledId,
  onPick,
  clearable,
  onClear,
}: {
  label: string;
  value: string;
  open: boolean;
  setOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  stops: { id: string; name: string; count: number }[];
  selectedId: string | null;
  disabledId?: string | null;
  onPick: (id: string) => void;
  clearable?: boolean;
  onClear?: () => void;
}) {
  return (
    <div className={`relative ${open ? "z-30" : ""}`} ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-left text-xs text-neutral-300 hover:border-neutral-700"
      >
        <span className="min-w-0 truncate">
          <span className="mr-1 text-[10px] uppercase tracking-wider text-neutral-500">
            {label}
          </span>
          <span className="font-medium text-neutral-100">{value}</span>
        </span>
        <ChevronDown size={14} className="shrink-0 text-neutral-500" />
      </button>
      {open && (
        <ul
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[40dvh] overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg border border-neutral-800 bg-neutral-950/95 shadow-2xl backdrop-blur touch-pan-y sm:max-h-60"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {clearable && onClear && (
            <li>
              <button
                onClick={onClear}
                className={`block w-full truncate px-3 py-1.5 text-left text-xs italic hover:bg-neutral-900 ${
                  selectedId == null ? "bg-neutral-900 text-cyan-300" : "text-neutral-400"
                }`}
              >
                Any stop (show all)
              </button>
            </li>
          )}
          {stops.slice(0, 200).map((s) => {
            const isSelected = s.id === selectedId;
            const isDisabled = disabledId != null && s.id === disabledId;
            return (
              <li key={s.id}>
                <button
                  disabled={isDisabled}
                  onClick={() => !isDisabled && onPick(s.id)}
                  className={`block w-full truncate px-3 py-1.5 text-left text-xs ${
                    isDisabled
                      ? "cursor-not-allowed text-neutral-600"
                      : "hover:bg-neutral-900"
                  } ${
                    isSelected
                      ? "bg-neutral-900 text-cyan-300"
                      : isDisabled
                      ? ""
                      : "text-neutral-300"
                  }`}
                >
                  {s.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
