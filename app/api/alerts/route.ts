import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 300;

interface ATAlert {
  id: string;
  header: string;
  description?: string;
  routeGroups?: string[];
  url?: string;
}

interface ATAlertsResponse {
  response?: {
    alerts?: ATAlert[];
  };
}

const ACT_ALERTS_URL =
  "https://api-cf-au9.anytrip.com.au/api/v3/region/au9/alerts";
const NSW_ALERTS_URL =
  "https://api-cf-oc2.anytrip.com.au/api/v3/region/au2/alerts";

const headers = {
  Accept: "application/json",
  "User-Agent": "AnyTrip/3.0",
};

let alertsCache: { data: ATAlert[]; at: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

export async function GET() {
  if (alertsCache && Date.now() - alertsCache.at < CACHE_TTL) {
    return NextResponse.json({ alerts: alertsCache.data });
  }

  const [actRes, nswRes] = await Promise.allSettled([
    fetch(ACT_ALERTS_URL, { headers, cache: "no-store" }),
    fetch(NSW_ALERTS_URL, { headers, cache: "no-store" }),
  ]);

  const alerts: ATAlert[] = [];

  if (actRes.status === "fulfilled" && actRes.value.ok) {
    const json = (await actRes.value.json()) as ATAlertsResponse;
    alerts.push(...(json.response?.alerts ?? []));
  }
  if (nswRes.status === "fulfilled" && nswRes.value.ok) {
    const json = (await nswRes.value.json()) as ATAlertsResponse;
    alerts.push(...(json.response?.alerts ?? []));
  }

  alertsCache = { data: alerts, at: Date.now() };
  return NextResponse.json({ alerts });
}
