"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Star,
  MapPin,
  X,
  Route as RouteIcon,
  Search,
  ArrowRight,
} from "lucide-react";
import { FAVOURITE_ROUTES, PLACES } from "@/lib/favourites";

export interface QuickFiltersState {
  /** selected route short names; empty set = all (no route filter) */
  routes: Set<string>;
  /** selected place id, or null */
  place: string | null;
}

/** Normalise free-text input into a canonical route number.
 *   "r2" / "R2"        → "2"       (via FAVOURITE_ROUTES alias)
 *   "  844x "          → "844X"    (ACT GTFS uses uppercase X suffixes)
 *   "Route 56"         → "56"      (strip the word "route" / "bus")
 */
function normaliseQuery(raw: string): string {
  const cleaned = raw.trim().replace(/^(route|bus)\s+/i, "");
  if (!cleaned) return "";
  const lower = cleaned.toLowerCase();
  const match = FAVOURITE_ROUTES.find(
    (r) =>
      r.number.toLowerCase() === lower ||
      r.aliases?.some((a) => a.toLowerCase() === lower)
  );
  if (match) return match.number;
  // Keep ACT's `X1`/`X2`/`844X` upper-cased; pure numerics stay as-is.
  return /^[0-9]+[a-z]$/i.test(cleaned) ? cleaned.toUpperCase() : cleaned;
}

export function QuickFilters({
  state,
  onChange,
}: {
  state: QuickFiltersState;
  onChange: (next: QuickFiltersState) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const allSelected =
    state.routes.size === FAVOURITE_ROUTES.length &&
    FAVOURITE_ROUTES.every((r) => state.routes.has(r.number));
  const anySelected = state.routes.size > 0;

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as { number: string; label: string }[];
    const normalised = normaliseQuery(query).toLowerCase();
    // Matches favourites by number, alias, or label prefix.
    const hits: { number: string; label: string }[] = [];
    for (const r of FAVOURITE_ROUTES) {
      if (
        r.number.toLowerCase().startsWith(q) ||
        r.aliases?.some((a) => a.toLowerCase().startsWith(q)) ||
        (r.label?.toLowerCase().startsWith(q) ?? false) ||
        r.number.toLowerCase() === normalised
      ) {
        hits.push({ number: r.number, label: r.label ?? r.number });
      }
    }
    // Always offer the normalised query itself as a "try this" row so users
    // can drill into routes not in the favourites list (e.g. 56, 901, 844X).
    const extra = normaliseQuery(query);
    if (
      extra &&
      !hits.some((h) => h.number.toLowerCase() === extra.toLowerCase())
    ) {
      hits.push({ number: extra, label: extra });
    }
    return hits.slice(0, 6);
  }, [query]);

  const submitQuery = () => {
    const n = normaliseQuery(query);
    if (!n) return;
    router.push(`/map?routes=${encodeURIComponent(n)}`);
  };

  const setRoutes = (routes: Set<string>) =>
    onChange({ ...state, routes });
  const setPlace = (place: string | null) => onChange({ ...state, place });

  const toggleRoute = (num: string) => {
    const next = new Set(state.routes);
    if (next.has(num)) next.delete(num);
    else next.add(num);
    setRoutes(next);
  };

  const togglePlace = (id: string) => {
    setPlace(state.place === id ? null : id);
  };

  const selectAll = () => {
    setRoutes(new Set(FAVOURITE_ROUTES.map((r) => r.number)));
  };
  const clearAll = () => {
    setRoutes(new Set());
  };

  return (
    <div className="space-y-3">
      {/* Search any route — jumps straight to the map with that route's
          shape + stops overlaid (AnyTrip-style). */}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2 focus-within:border-cyan-500/50">
          <Search size={14} className="text-neutral-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitQuery();
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search a route — R2, R6, 56, 844X…"
            className="flex-1 bg-transparent text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-neutral-500 hover:text-neutral-200"
              aria-label="Clear"
            >
              <X size={14} />
            </button>
          )}
          <button
            onClick={submitQuery}
            disabled={!normaliseQuery(query)}
            className="flex items-center gap-1 rounded-md bg-cyan-500/90 px-2 py-1 text-xs font-semibold text-neutral-950 hover:bg-cyan-400 disabled:opacity-40"
          >
            Track
            <ArrowRight size={12} />
          </button>
        </div>

        {suggestions.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950/95 shadow-2xl backdrop-blur">
            {suggestions.map((s) => (
              <li key={s.number}>
                <Link
                  href={`/map?routes=${encodeURIComponent(s.number)}`}
                  prefetch={false}
                  onClick={() => setQuery("")}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
                >
                  <span className="flex items-center gap-2 font-semibold tabular-nums">
                    <RouteIcon size={12} className="text-cyan-400" />
                    {s.label}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                    View on map
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Route chips header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-neutral-400">
          <Star size={12} />
          My buses
        </div>
        <div className="flex gap-1">
          <button
            onClick={selectAll}
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition ${
              allSelected
                ? "bg-cyan-500 text-neutral-950"
                : "bg-neutral-900 text-neutral-400 hover:text-neutral-100"
            }`}
          >
            All
          </button>
          <button
            onClick={clearAll}
            disabled={!anySelected}
            className="rounded-full bg-neutral-900 px-2.5 py-0.5 text-[10px] font-medium text-neutral-400 hover:text-neutral-100 disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Route chips — tap the chip to toggle in list view, tap the small
          "track" icon to jump to the map with only that route highlighted. */}
      <div className="flex flex-wrap gap-1.5">
        {FAVOURITE_ROUTES.map((r) => {
          const active = state.routes.has(r.number);
          return (
            <div
              key={r.number}
              className={`group inline-flex items-stretch overflow-hidden rounded-lg border text-xs font-semibold tabular-nums transition ${
                active
                  ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-200"
                  : "border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:border-neutral-700 hover:text-neutral-100"
              }`}
            >
              <button
                onClick={() => toggleRoute(r.number)}
                className="px-2.5 py-1"
              >
                {r.label ?? r.number}
              </button>
              <Link
                href={`/map?routes=${encodeURIComponent(r.number)}`}
                prefetch={false}
                aria-label={`Track route ${r.number} on map`}
                className={`flex items-center border-l px-1.5 transition ${
                  active
                    ? "border-cyan-400/40 text-cyan-300/70 hover:bg-cyan-500/25 hover:text-cyan-100"
                    : "border-neutral-800 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100"
                }`}
              >
                <RouteIcon size={12} />
              </Link>
            </div>
          );
        })}
      </div>

      {/* Places */}
      <div className="flex items-center gap-1.5 pt-1 text-[11px] font-medium uppercase tracking-wider text-neutral-400">
        <MapPin size={12} />
        Near
        {state.place && (
          <button
            onClick={() => setPlace(null)}
            className="ml-auto flex items-center gap-1 rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] normal-case tracking-normal text-neutral-400 hover:text-neutral-100"
          >
            <X size={10} />
            Clear place
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PLACES.map((p) => {
          const active = state.place === p.id;
          return (
            <button
              key={p.id}
              onClick={() => togglePlace(p.id)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                active
                  ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
                  : "border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:border-neutral-700 hover:text-neutral-100"
              }`}
            >
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
