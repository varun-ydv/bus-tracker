"use client";

import { Search, X } from "lucide-react";

export function FilterBar({
  filter,
  onFilterChange,
  provider,
  onProviderChange,
}: {
  filter: string;
  onFilterChange: (s: string) => void;
  provider: "all" | "canberra" | "nsw" | "anytrip";
  onProviderChange: (p: "all" | "canberra" | "nsw" | "anytrip") => void;
}) {
  const PROVIDERS = ["all", "canberra", "nsw", "anytrip"] as const;
  const LABEL = {
    all: "All",
    canberra: "ACT",
    nsw: "NSW",
    anytrip: "AnyTrip",
  } as const;
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
        />
        <input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          type="text"
          inputMode="search"
          placeholder="Route number (e.g. 830, 56, R3)"
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 py-2.5 pl-9 pr-9 text-sm text-neutral-100 placeholder-neutral-500 focus:border-cyan-500 focus:outline-none"
        />
        {filter && (
          <button
            onClick={() => onFilterChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            aria-label="Clear"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="flex gap-1 rounded-lg bg-neutral-900/60 p-1">
        {PROVIDERS.map((p) => (
          <button
            key={p}
            onClick={() => onProviderChange(p)}
            className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${
              provider === p
                ? "bg-neutral-100 text-neutral-900"
                : "text-neutral-400 hover:text-neutral-100"
            }`}
          >
            {LABEL[p]}
          </button>
        ))}
      </div>
    </div>
  );
}
