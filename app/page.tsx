"use client";

import { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { VehicleProviderFilter, VehiclesResponse, Vehicle } from "@/lib/types";
import { BusCard } from "@/components/BusCard";
import { StatusBar } from "@/components/StatusBar";
import { PoweredByTransit } from "@/components/PoweredByTransit";
import { QuickFilters, type QuickFiltersState } from "@/components/QuickFilters";
import {
  DEFAULT_FAVOURITE_NUMBERS,
  dormantRoutesForPlace,
  findPlace,
} from "@/lib/favourites";
import { Map, RefreshCw, Settings, MoonStar } from "lucide-react";
import Link from "next/link";

const VEHICLE_PROVIDERS = new Set<VehicleProviderFilter>([
  "all",
  "canberra",
  "nsw",
  "anytrip",
  "nextthere",
]);

function vehicleProviderFromParam(raw: string | null): VehicleProviderFilter {
  return raw && VEHICLE_PROVIDERS.has(raw as VehicleProviderFilter)
    ? (raw as VehicleProviderFilter)
    : "all";
}

function HomePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialise from URL; if no `routes` param at all, default to all favourites.
  const initialState: QuickFiltersState = useMemo(() => {
    const routesParam = searchParams.get("routes");
    const routes =
      routesParam === null
        ? new Set(DEFAULT_FAVOURITE_NUMBERS)
        : routesParam === ""
        ? new Set<string>()
        : new Set(routesParam.split(",").map((s) => s.trim()).filter(Boolean));
    return {
      routes,
      place: searchParams.get("place"),
      provider: vehicleProviderFromParam(searchParams.get("provider")),
    };
    // initial only — deliberately omit searchParams from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [filters, setFilters] = useState<QuickFiltersState>(initialState);
  const [data, setData] = useState<VehiclesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Keep URL in sync with filters (so /map inherits, and shareable links work).
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.routes.size > 0) {
      params.set("routes", Array.from(filters.routes).join(","));
    } else {
      params.set("routes", ""); // explicit empty => "show everything"
    }
    if (filters.place) params.set("place", filters.place);
    if (filters.provider !== "all") params.set("provider", filters.provider);
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }, [filters, router]);

  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      const params = new URLSearchParams();
      if (filters.routes.size > 0) {
        params.set("routes", Array.from(filters.routes).join(","));
      }
      if (filters.place) params.set("place", filters.place);
      if (filters.provider !== "all") params.set("provider", filters.provider);
      const res = await fetch(`/api/vehicles?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: VehiclesResponse = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 15000);
    return () => clearInterval(id);
  }, [fetchData]);

  const vehicles: Vehicle[] = data?.vehicles ?? [];
  const sorted = [...vehicles].sort((a, b) => {
    const ra = a.routeShortName ?? a.routeId ?? a.label ?? "";
    const rb = b.routeShortName ?? b.routeId ?? b.label ?? "";
    return ra.localeCompare(rb, undefined, { numeric: true });
  });

  const mapHref = (() => {
    const p = new URLSearchParams();
    if (filters.routes.size > 0) {
      p.set("routes", Array.from(filters.routes).join(","));
    }
    if (filters.place) p.set("place", filters.place);
    if (filters.provider !== "all") p.set("provider", filters.provider);
    const qs = p.toString();
    return qs ? `/map?${qs}` : "/map";
  })();

  const selectedPlace = findPlace(filters.place);
  const placeLabel = selectedPlace?.name ?? null;
  const dormant = selectedPlace
    ? dormantRoutesForPlace(selectedPlace, vehicles)
    : [];

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col px-4 pb-24 pt-[max(env(safe-area-inset-top),1rem)]">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bus Tracker</h1>
          <p className="text-xs text-neutral-400">Canberra · Queanbeyan</p>
        </div>
        <div className="flex gap-1">
          <button
            onClick={fetchData}
            className="rounded-full bg-neutral-900 p-2.5 text-neutral-300 hover:bg-neutral-800"
            aria-label="Refresh"
          >
            <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
          </button>
          <Link
            href={mapHref}
            className="rounded-full bg-neutral-900 p-2.5 text-neutral-300 hover:bg-neutral-800"
            aria-label="Map"
          >
            <Map size={18} />
          </Link>
          <Link
            href="/setup"
            className="rounded-full bg-neutral-900 p-2.5 text-neutral-300 hover:bg-neutral-800"
            aria-label="Setup"
          >
            <Settings size={18} />
          </Link>
        </div>
      </header>

      <StatusBar data={data} />
      {data?.providers.transit.configured && (
        <div className="mb-3">
          <PoweredByTransit />
        </div>
      )}

      <QuickFilters state={filters} onChange={setFilters} />

      {loading && (
        <div className="mt-8 flex justify-center text-sm text-neutral-400">
          Loading live data…
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && sorted.length === 0 && (
        <div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900/60 p-6 text-center text-sm text-neutral-400">
          {filters.routes.size === 0 && !filters.place
            ? "No filters selected — tap a route or a place above."
            : placeLabel && filters.routes.size > 0
            ? `No selected buses near ${placeLabel} right now.`
            : placeLabel
            ? `No buses near ${placeLabel} right now.`
            : "None of your selected buses are running right now."}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {sorted.map((v) => (
          <BusCard key={`${v.provider}-${v.id}`} vehicle={v} />
        ))}
      </div>

      {selectedPlace && dormant.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
            <MoonStar size={12} />
            Also serves {selectedPlace.name}
            <span className="ml-1 text-neutral-600 normal-case tracking-normal">
              · not running right now
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dormant.map((r) => (
              <span
                key={r.number}
                className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-2.5 py-1 text-xs font-semibold tabular-nums text-neutral-500"
                title={
                  r.agencyContains
                    ? `Served by ${r.agencyContains} — no live bus right now`
                    : "Scheduled — no live bus right now"
                }
              >
                {r.number}
              </span>
            ))}
          </div>
        </div>
      )}

      {data && (
        <p className="mt-6 text-center text-[10px] text-neutral-600">
          {sorted.length} live bus{sorted.length === 1 ? "" : "es"}
          {placeLabel ? ` at ${placeLabel}` : ""}
          {selectedPlace && dormant.length > 0
            ? ` · ${dormant.length} scheduled route${dormant.length === 1 ? "" : "s"} off-service`
            : ""}
          {" · "}updated {new Date(data.fetchedAt).toLocaleTimeString()} · auto-refresh 15s
        </p>
      )}
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomePageInner />
    </Suspense>
  );
}
