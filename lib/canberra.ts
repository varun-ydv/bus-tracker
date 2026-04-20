import { fetchGtfsRtVehicles } from "./gtfs";
import type { Vehicle } from "./types";

const CANBERRA_VEHICLE_POSITIONS_URL =
  process.env.CANBERRA_VEHICLE_POSITIONS_URL ??
  "https://transport.api.act.gov.au/gtfs/data/gtfs/v2/vehicle-positions.pb";

export function canberraConfigured(): boolean {
  return Boolean(process.env.CANBERRA_CLIENT_ID && process.env.CANBERRA_CLIENT_SECRET);
}

export async function fetchCanberraVehicles(): Promise<Vehicle[]> {
  const clientId = process.env.CANBERRA_CLIENT_ID;
  const clientSecret = process.env.CANBERRA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "CANBERRA_CLIENT_ID and CANBERRA_CLIENT_SECRET not set. Register at transport.act.gov.au/contact-us/information-for-developers"
    );
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  return fetchGtfsRtVehicles(
    CANBERRA_VEHICLE_POSITIONS_URL,
    {
      Authorization: `Basic ${credentials}`,
      Accept: "application/x-google-protobuf",
    },
    "canberra"
  );
}
