#!/usr/bin/env python3
"""
Build two lean JSON catalogues of ACT bus routes from the Transport Canberra
GTFS static feed:

  data/act-routes.json      —  {shortName: {shapes, stops, color}}
  data/act-timetables.json  —  {services, routes: {shortName: {trips: [...]}}}
                               (scheduled trip times for the departures panel)

Run with:  python3 scripts/build-act-routes.py
Depends on:  /tmp/act_gtfs/*.txt (download google_transit.zip and unzip there)

We intentionally keep ONLY the routes that appear in lib/favourites.ts's
FAVOURITE_ROUTES + PLACES catalogue — that's the set the app can ever ask
for. Everything else is dropped to keep the JSON small.
"""

from __future__ import annotations

import csv
import json
import os
import sys
from pathlib import Path

GTFS_DIR = Path(os.environ.get("ACT_GTFS_DIR", "/tmp/act_gtfs"))
OUT_DIR = Path(__file__).resolve().parent.parent / "data"
OUT_PATH = OUT_DIR / "act-routes.json"
TIMETABLE_PATH = OUT_DIR / "act-timetables.json"

# Routes we care about (mirror lib/favourites.ts — any short_name that might
# appear as a favourite chip or in a place's canonical route list).
WANTED_SHORTNAMES = {
    # Rapid 1-10
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
    # local trunk / frequent
    "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28",
    "30", "31", "32",
    "41", "43", "44", "45",
    "50", "51", "53", "54", "55", "56", "57", "58", "59",
    "180", "181", "182",
    "901",
    "X1", "X2",
}


def read_csv(path: Path):
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def main() -> int:
    if not GTFS_DIR.exists():
        print(f"ERROR: {GTFS_DIR} not found. Download the ACT GTFS first.",
              file=sys.stderr)
        return 1

    print(f"Reading routes from {GTFS_DIR} …")

    # route_id → short_name (only for wanted routes), plus colour per short_name
    route_id_to_short: dict[str, str] = {}
    short_to_color: dict[str, str] = {}
    for r in read_csv(GTFS_DIR / "routes.txt"):
        sn = (r.get("route_short_name") or "").strip()
        if sn in WANTED_SHORTNAMES:
            route_id_to_short[r["route_id"]] = sn
            col = (r.get("route_color") or "").strip()
            if col and sn not in short_to_color:
                short_to_color[sn] = f"#{col}"
    print(f"  matched route_ids: {len(route_id_to_short)}")

    # short_name → set(shape_id), set(trip_id)
    short_to_shapes: dict[str, set[str]] = {s: set() for s in WANTED_SHORTNAMES}
    short_to_trips: dict[str, set[str]] = {s: set() for s in WANTED_SHORTNAMES}
    for t in read_csv(GTFS_DIR / "trips.txt"):
        sn = route_id_to_short.get(t["route_id"])
        if not sn:
            continue
        shape_id = (t.get("shape_id") or "").strip()
        if shape_id:
            short_to_shapes[sn].add(shape_id)
        short_to_trips[sn].add(t["trip_id"])

    all_wanted_shape_ids = set().union(*short_to_shapes.values())
    print(f"  total distinct shape_ids we need: {len(all_wanted_shape_ids)}")

    # shape_id → ordered [(seq, lat, lon)]
    shape_points: dict[str, list[tuple[int, float, float]]] = {
        s: [] for s in all_wanted_shape_ids
    }
    for s in read_csv(GTFS_DIR / "shapes.txt"):
        sid = s["shape_id"]
        if sid in shape_points:
            shape_points[sid].append((
                int(s["shape_pt_sequence"]),
                float(s["shape_pt_lat"]),
                float(s["shape_pt_lon"]),
            ))

    # Reduce shapes: coalesce identical polylines and drop trivial ones.
    def reduce(pts: list[tuple[int, float, float]]) -> list[list[float]]:
        pts.sort(key=lambda p: p[0])
        return [[round(la, 5), round(lo, 5)] for _, la, lo in pts]

    # short_name → list of unique polylines
    short_to_polys: dict[str, list[list[list[float]]]] = {}
    for sn, shape_ids in short_to_shapes.items():
        seen_sig = set()
        out: list[list[list[float]]] = []
        for sid in shape_ids:
            poly = reduce(shape_points.get(sid, []))
            if len(poly) < 2:
                continue
            # dedupe using start/end/length signature
            sig = (tuple(poly[0]), tuple(poly[-1]), len(poly))
            if sig in seen_sig:
                continue
            seen_sig.add(sig)
            out.append(poly)
        short_to_polys[sn] = out

    # collect trip_id → set(stop_id) only for wanted trip ids
    all_wanted_trip_ids = set().union(*short_to_trips.values())
    short_to_stop_ids: dict[str, set[str]] = {s: set() for s in WANTED_SHORTNAMES}
    # Reverse lookup: trip_id → short_name (a trip has exactly one route)
    trip_to_short: dict[str, str] = {}
    for sn, trip_ids in short_to_trips.items():
        for tid in trip_ids:
            trip_to_short[tid] = sn

    print(f"  scanning stop_times for {len(all_wanted_trip_ids)} trips …")
    stop_ids_total: set[str] = set()
    for row in read_csv(GTFS_DIR / "stop_times.txt"):
        tid = row["trip_id"]
        sn = trip_to_short.get(tid)
        if not sn:
            continue
        sid = row["stop_id"]
        short_to_stop_ids[sn].add(sid)
        stop_ids_total.add(sid)

    print(f"  total unique stops across wanted routes: {len(stop_ids_total)}")

    # stop_id → {name, lat, lon}
    stops_catalogue: dict[str, dict] = {}
    for s in read_csv(GTFS_DIR / "stops.txt"):
        sid = s["stop_id"]
        if sid in stop_ids_total:
            try:
                lat = float(s["stop_lat"])
                lon = float(s["stop_lon"])
            except (KeyError, ValueError):
                continue
            stops_catalogue[sid] = {
                "id": sid,
                "name": (s.get("stop_name") or "").strip(),
                "lat": round(lat, 5),
                "lon": round(lon, 5),
            }

    # Assemble final structure.
    out: dict[str, dict] = {}
    for sn in sorted(WANTED_SHORTNAMES, key=lambda x: (len(x), x)):
        polys = short_to_polys.get(sn, [])
        stop_ids = short_to_stop_ids.get(sn, set())
        stops = [stops_catalogue[sid] for sid in stop_ids if sid in stops_catalogue]
        stops.sort(key=lambda s: s["name"])
        if not polys and not stops:
            continue
        entry: dict = {
            "shapes": polys,
            "stops": stops,
        }
        if sn in short_to_color:
            entry["color"] = short_to_color[sn]
        out[sn] = entry

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"Wrote {OUT_PATH}: {size_kb:.1f} KB, {len(out)} routes")
    for sn, v in out.items():
        print(f"  {sn:>4}: {len(v['shapes'])} shapes, {len(v['stops'])} stops")

    # ──────────────────────────────────────────────────────────────────────
    # Timetable catalogue  (one trip = scheduled stop times for today's feed)
    # ──────────────────────────────────────────────────────────────────────
    print("\nBuilding timetable catalogue …")

    # services: calendar.txt → day-of-week flags + validity window
    services: dict[str, dict] = {}
    for row in read_csv(GTFS_DIR / "calendar.txt"):
        services[row["service_id"]] = {
            "days": [
                int(row.get(d, 0) or 0)
                for d in (
                    "monday", "tuesday", "wednesday", "thursday",
                    "friday", "saturday", "sunday",
                )
            ],
            "start": row.get("start_date", ""),
            "end": row.get("end_date", ""),
            "exceptions": {},
        }
    # calendar_dates.txt → add/remove overrides per date
    for row in read_csv(GTFS_DIR / "calendar_dates.txt"):
        sid = row["service_id"]
        if sid not in services:
            services[sid] = {
                "days": [0]*7, "start": "", "end": "", "exceptions": {}
            }
        services[sid]["exceptions"][row["date"]] = int(row["exception_type"])

    # trip metadata for wanted routes
    # keep: id, route short_name, service_id, direction_id, headsign
    trip_meta: dict[str, dict] = {}
    for t in read_csv(GTFS_DIR / "trips.txt"):
        sn = route_id_to_short.get(t["route_id"])
        if not sn:
            continue
        trip_meta[t["trip_id"]] = {
            "sn": sn,
            "h": (t.get("trip_headsign") or "").strip(),
            "s": t["service_id"],
            "d": int(t.get("direction_id") or 0),
        }

    # stop_times for wanted trips (second pass over the big file)
    print(f"  scanning stop_times for {len(trip_meta)} trips (timetable) …")
    trip_stops: dict[str, list[tuple[int, str, str, str]]] = {
        tid: [] for tid in trip_meta
    }
    for row in read_csv(GTFS_DIR / "stop_times.txt"):
        tid = row["trip_id"]
        meta = trip_meta.get(tid)
        if not meta:
            continue
        # drop seconds for compactness — HH:MM:SS → HH:MM
        dep = (row.get("departure_time") or row.get("arrival_time") or "").strip()
        arr = (row.get("arrival_time") or dep).strip()
        if len(dep) >= 5: dep = dep[:5]
        if len(arr) >= 5: arr = arr[:5]
        try:
            seq = int(row["stop_sequence"])
        except (KeyError, ValueError):
            continue
        trip_stops[tid].append((seq, row["stop_id"], dep, arr))

    # Assemble per-route trip lists.
    routes_out: dict[str, dict] = {}
    for tid, meta in trip_meta.items():
        sn = meta["sn"]
        sts = trip_stops.get(tid) or []
        if not sts:
            continue
        sts.sort(key=lambda x: x[0])
        # compact: stop_id, departure (only). arrival dropped when ==dep.
        st_compact = []
        for _seq, sid, dep, arr in sts:
            if arr == dep:
                st_compact.append([sid, dep])
            else:
                st_compact.append([sid, dep, arr])
        routes_out.setdefault(sn, {"trips": []})["trips"].append({
            "id": tid,
            "h": meta["h"],
            "s": meta["s"],
            "d": meta["d"],
            "st": st_compact,
        })

    # Sort trips within each route by their first scheduled departure.
    for sn, entry in routes_out.items():
        entry["trips"].sort(key=lambda t: (t["st"][0][1], t["id"]))

    # Prune services that no route actually references (keeps file lean).
    referenced_services = {t["s"] for e in routes_out.values() for t in e["trips"]}
    services_out = {sid: v for sid, v in services.items() if sid in referenced_services}

    timetable = {
        "services": services_out,
        "routes": routes_out,
    }
    with open(TIMETABLE_PATH, "w", encoding="utf-8") as f:
        json.dump(timetable, f, separators=(",", ":"))
    size_mb = TIMETABLE_PATH.stat().st_size / (1024 * 1024)
    print(f"Wrote {TIMETABLE_PATH}: {size_mb:.2f} MB, "
          f"{len(services_out)} services, {len(routes_out)} routes")
    for sn in sorted(routes_out, key=lambda x: (len(x), x)):
        n = len(routes_out[sn]["trips"])
        print(f"  {sn:>4}: {n} trips")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
