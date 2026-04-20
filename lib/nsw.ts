import { fetchGtfsRtVehicles } from "./gtfs";
import type { Vehicle } from "./types";

const NSW_BUSES_VEHICLE_POSITIONS_URL =
  process.env.NSW_VEHICLE_POSITIONS_URL ??
  "https://api.transport.nsw.gov.au/v1/gtfs/vehiclepos/buses";

export function nswConfigured(): boolean {
  return Boolean(process.env.NSW_API_KEY);
}

export async function fetchNswVehicles(): Promise<Vehicle[]> {
  const key = process.env.NSW_API_KEY;
  if (!key) {
    throw new Error(
      "NSW_API_KEY not set. Register at opendata.transport.nsw.gov.au"
    );
  }

  return fetchGtfsRtVehicles(
    NSW_BUSES_VEHICLE_POSITIONS_URL,
    {
      Authorization: `apikey ${key}`,
      Accept: "application/x-google-protobuf",
    },
    "nsw"
  );
}
