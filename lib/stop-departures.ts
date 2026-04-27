import type { TimingProvider } from "./types";

export interface StopDeparture {
  tripId: string;
  routeNumber: string;
  routeColor?: string | null;
  routeLongName?: string | null;
  headsign: string;
  time: string;
  date: string;
  minutesFromNow: number;
  delaySeconds?: number | null;
  live?: boolean;
}

export interface StopDeparturesResult {
  stopId: string;
  stopName: string;
  source: { provider: TimingProvider; label: string };
  now: { hhmm: string; yyyymmdd: string; tz: string };
  departures: StopDeparture[];
}
