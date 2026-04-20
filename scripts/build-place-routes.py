#!/usr/bin/env python3
"""
Regenerate the per-place route lists in lib/favourites.ts from the authoritative
ACT GTFS static feed.

Usage:
    # Needs your Canberra developer credentials in .env.local
    python3 scripts/build-place-routes.py

What it does:
    1. Downloads the ACT GTFS static zip (routes/stops/trips/stop_times)
    2. Finds every stop within each place's radius
    3. Finds every route that has a timetabled stop at any of those stops
    4. Prints a TypeScript snippet with the curated route lists

Note: Queanbeyan is in NSW and not in the ACT feed — its Qcity Transit routes
are curated manually in favourites.ts and verified against AnyTrip.
"""
from __future__ import annotations

import base64
import csv
import io
import math
import os
import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

GTFS_URL = (
    "https://transport.api.act.gov.au/gtfs/data/gtfs/v2/google_transit.zip"
)

# Centre + search radius (metres) of each ACT-side place. Increase the radius
# to capture more peripheral stops (e.g. UC campus sprawl).
PLACES: dict[str, tuple[float, float, int]] = {
    "city":      (-35.2785, 149.1300, 800),
    "dickson":   (-35.2502, 149.1389, 800),
    "gungahlin": (-35.1853, 149.1338, 1200),
    "uc":        (-35.2380, 149.0846, 1200),
}


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlam / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(a))


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def download_gtfs(client_id: str, client_secret: str) -> zipfile.ZipFile:
    token = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    req = urllib.request.Request(GTFS_URL, headers={"Authorization": f"Basic {token}"})
    print(f"Downloading ACT GTFS from {GTFS_URL} …", file=sys.stderr)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    print(f"  got {len(data):,} bytes", file=sys.stderr)
    return zipfile.ZipFile(io.BytesIO(data))


def read_csv(zf: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    with zf.open(name) as fh:
        text = fh.read().decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def main() -> int:
    env = load_env(Path(__file__).resolve().parent.parent / ".env.local")
    cid = os.environ.get("CANBERRA_CLIENT_ID") or env.get("CANBERRA_CLIENT_ID")
    cs = os.environ.get("CANBERRA_CLIENT_SECRET") or env.get("CANBERRA_CLIENT_SECRET")
    if not cid or not cs:
        print(
            "error: CANBERRA_CLIENT_ID / CANBERRA_CLIENT_SECRET missing "
            "(.env.local or env vars)",
            file=sys.stderr,
        )
        return 1

    zf = download_gtfs(cid, cs)

    # 1. stops near each place
    stops_for_place: dict[str, set[str]] = {p: set() for p in PLACES}
    for row in read_csv(zf, "stops.txt"):
        try:
            lat, lon = float(row["stop_lat"]), float(row["stop_lon"])
        except (KeyError, ValueError):
            continue
        for pid, (plat, plon, rad) in PLACES.items():
            if haversine(plat, plon, lat, lon) <= rad:
                stops_for_place[pid].add(row["stop_id"])
    for pid, sids in stops_for_place.items():
        print(f"# {pid}: {len(sids)} stops within radius", file=sys.stderr)

    # 2. trip_id -> route_id
    trip_route = {r["trip_id"]: r["route_id"] for r in read_csv(zf, "trips.txt")}

    # 3. routes timetabled at any of the place's stops
    routes_for_place: dict[str, set[str]] = defaultdict(set)
    for row in read_csv(zf, "stop_times.txt"):
        rid = trip_route.get(row["trip_id"])
        if not rid:
            continue
        for pid, sids in stops_for_place.items():
            if row["stop_id"] in sids:
                routes_for_place[pid].add(rid)

    # 4. route_id -> short name
    route_short = {
        r["route_id"]: r["route_short_name"] for r in read_csv(zf, "routes.txt")
    }

    print()
    for pid in PLACES:
        shorts = sorted(
            {route_short[r] for r in routes_for_place[pid] if r in route_short},
            key=lambda x: (not x[:1].isdigit(), len(x), x),
        )
        quoted = ", ".join(f'"{s}"' for s in shorts)
        print(f"{pid}: [{quoted}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
