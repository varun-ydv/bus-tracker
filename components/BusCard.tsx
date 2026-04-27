import type { Vehicle } from "@/lib/types";
import Link from "next/link";
import { MapPin, Gauge, Clock, ArrowRight, ChevronRight } from "lucide-react";

const PROVIDER_BADGE: Record<Vehicle["provider"], string> = {
  canberra: "ACT",
  nsw: "NSW",
  anytrip: "AT",
  nextthere: "NT",
  transit: "TR",
};

export function BusCard({ vehicle }: { vehicle: Vehicle }) {
  const ageSeconds = Math.max(
    0,
    Math.floor(Date.now() / 1000) - vehicle.timestamp
  );
  const ageLabel =
    ageSeconds < 60
      ? `${ageSeconds}s ago`
      : ageSeconds < 3600
      ? `${Math.floor(ageSeconds / 60)}m ago`
      : `${Math.floor(ageSeconds / 3600)}h ago`;

  const speedKmh = vehicle.speed != null ? (vehicle.speed * 3.6).toFixed(0) : null;
  const routeLabel = vehicle.routeShortName ?? vehicle.routeId ?? vehicle.label ?? "—";

  const tileBg =
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

  return (
    <Link
      href={`/map?routes=${encodeURIComponent(routeLabel)}`}
      className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 backdrop-blur hover:border-neutral-700 hover:bg-neutral-900/80 transition-colors"
    >
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-neutral-950"
        style={{ backgroundColor: tileBg }}
      >
        {routeLabel}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {vehicle.headsign ? (
              <>
                <ArrowRight size={11} className="mr-1 inline opacity-60" />
                {vehicle.headsign}
              </>
            ) : (
              vehicle.label ?? `Bus ${vehicle.id}`
            )}
          </span>
          <span className="rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">
            {PROVIDER_BADGE[vehicle.provider]}
          </span>
        </div>
        {vehicle.agency && (
          <div className="truncate text-[10px] text-neutral-500">
            {vehicle.agency}
            {vehicle.label && ` · #${vehicle.label}`}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
          <span className="flex items-center gap-1">
            <MapPin size={11} />
            {vehicle.lat.toFixed(4)}, {vehicle.lon.toFixed(4)}
          </span>
          {speedKmh != null && (
            <span className="flex items-center gap-1">
              <Gauge size={11} />
              {speedKmh} km/h
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock size={11} />
            {ageLabel}
          </span>
        </div>
        {vehicle.statusString && (
          <div className="mt-1 truncate text-[10px] text-neutral-500">
            {vehicle.statusString}
          </div>
        )}
        {vehicle.occupancy && (
          <div className="mt-0.5 text-[10px] text-neutral-500">
            {vehicle.occupancy.replaceAll("_", " ").toLowerCase()}
          </div>
        )}
        <ChevronRight size={16} className="shrink-0 text-neutral-600" />
      </div>
    </Link>
  );
}
