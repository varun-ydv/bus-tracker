import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { Provider, Vehicle } from "./types";

const { transit_realtime } = GtfsRealtimeBindings;

export async function fetchGtfsRtVehicles(
  url: string,
  headers: Record<string, string>,
  provider: Provider
): Promise<Vehicle[]> {
  const res = await fetch(url, {
    headers,
    cache: "no-store",
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(`${provider} GTFS-RT HTTP ${res.status}: ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const feed = transit_realtime.FeedMessage.decode(buffer);

  const vehicles: Vehicle[] = [];
  for (const entity of feed.entity) {
    const vp = entity.vehicle;
    if (!vp || !vp.position) continue;
    const { latitude, longitude, bearing, speed } = vp.position;
    if (typeof latitude !== "number" || typeof longitude !== "number") continue;

    vehicles.push({
      id: vp.vehicle?.id ?? entity.id,
      provider,
      routeId: vp.trip?.routeId ?? null,
      tripId: vp.trip?.tripId ?? null,
      label: vp.vehicle?.label ?? null,
      lat: latitude,
      lon: longitude,
      bearing: typeof bearing === "number" ? bearing : null,
      speed: typeof speed === "number" ? speed : null,
      timestamp: Number(vp.timestamp ?? Math.floor(Date.now() / 1000)),
      occupancy:
        vp.occupancyStatus != null
          ? transit_realtime.VehiclePosition.OccupancyStatus[vp.occupancyStatus] ?? null
          : null,
      currentStopSequence:
        typeof vp.currentStopSequence === "number" ? vp.currentStopSequence : null,
      currentStatus:
        vp.currentStatus != null
          ? transit_realtime.VehiclePosition.VehicleStopStatus[vp.currentStatus] ?? null
          : null,
    });
  }

  return vehicles;
}

export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
