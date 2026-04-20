import type { VehiclesResponse } from "@/lib/types";

export function StatusBar({ data }: { data: VehiclesResponse | null }) {
  if (!data) return null;
  const { canberra, nsw, anytrip } = data.providers;

  const dot = (
    configured: boolean,
    ok: boolean,
    error?: string
  ): { color: string; title: string } => {
    if (!configured)
      return { color: "bg-neutral-600", title: "Not configured" };
    if (ok) return { color: "bg-green-500", title: "Connected" };
    return { color: "bg-red-500", title: error ?? "Error" };
  };

  const items: Array<{ label: string; count: number; ok: boolean; configured: boolean; error?: string }> = [
    { label: "ACT", count: canberra.count, ok: canberra.ok, configured: canberra.configured, error: canberra.error },
    { label: "NSW", count: nsw.count, ok: nsw.ok, configured: nsw.configured, error: nsw.error },
    { label: "AnyTrip", count: anytrip.count, ok: anytrip.ok, configured: anytrip.configured, error: anytrip.error },
  ];

  return (
    <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
      {items.map((it) => {
        const d = dot(it.configured, it.ok, it.error);
        return (
          <div
            key={it.label}
            className="flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900/60 px-2.5 py-1"
          >
            <span className={`h-2 w-2 rounded-full ${d.color}`} title={d.title} />
            <span className="text-neutral-300">{it.label}</span>
            {it.ok && <span className="text-neutral-500">{it.count}</span>}
          </div>
        );
      })}
    </div>
  );
}
