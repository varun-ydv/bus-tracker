export type Provider = "canberra" | "nsw" | "anytrip" | "nextthere" | "transit";

export type TimingProvider = "auto" | Provider;
export type VehicleProviderFilter = Provider | "all";

export interface Vehicle {
  id: string;
  provider: Provider;
  routeId: string | null;
  routeShortName?: string | null;
  tripId: string | null;
  label?: string | null;
  lat: number;
  lon: number;
  bearing?: number | null;
  speed?: number | null;
  timestamp: number;
  occupancy?: string | null;
  currentStopSequence?: number | null;
  currentStatus?: string | null;
  agency?: string | null;
  headsign?: string | null;
  statusString?: string | null;
  routeColor?: string | null;
  delay?: number | null;
  vehicleType?: string | null;
  vehicleCapacity?: number | null;
}

export interface VehiclesResponse {
  vehicles: Vehicle[];
  providers: {
    [K in Provider]: {
      ok: boolean;
      count: number;
      error?: string;
      configured: boolean;
    };
  };
  fetchedAt: number;
}
