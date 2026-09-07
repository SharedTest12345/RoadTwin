"""Second-tier live road source: OSRM's public routing engine, itself built on the
OSM road network but a completely separate service from Overpass — when Overpass
(a free, donation-run, frequently overloaded/rate-limited service) is unreachable,
this can still return a REAL, road-network-following polyline with no API key.

Trade-off, stated honestly: OSRM returns geometry only, not the tag/context data
Overpass provides (lane count, speed limit, lighting, nearby signals/crossings/
schools/buildings). Every one of those fields already has a documented, labeled
"estimated" fallback in feature_extraction.py for exactly this situation — so a
route from here degrades to the same honesty story as an OSM way with sparse tags,
never a fabricated attribute presented as sourced.
"""
import logging
import math
import random
from typing import List, Optional, Tuple

import requests

from .. import config
from .base import RoadDataProvider, RawRoad
from ..services.geometry import polyline_length_m, haversine_m

log = logging.getLogger("roadtwin.osrm")

# OSRM routes actual road-network distance between two waypoints, which can run
# to several km on a winding ghat road even when the waypoints themselves are
# close — trimmed to a hero-length leading segment of the real route rather than
# rendering the whole multi-km path (mainly a traffic-sim/scenery-density budget
# concern, not a rendering one). This USED to also be constrained by camera
# framing: the overview shot's distance was computed straight off the path's
# bounding-box diagonal, which for a nearly-straight road is close to the full
# path length, so a long straight route pushed most of it past the fog's
# effective visible range and it rendered pure black past the first ~150-200m.
# CameraRig's overview framing now clamps that distance to a fixed 65-140 unit
# range regardless of the path's actual bounding box (see its own comment), so
# route length no longer feeds camera distance at all — this cap can reflect
# the real route's true dimensions on the map instead of a rendering workaround.
MAX_ROUTE_LENGTH_M = 2000.0

# Same curated real-world areas OSMProvider uses for "random road" discovery (see
# osm_provider.REGIONS) — two waypoints placed inside each bbox, ~1-1.5km apart,
# for OSRM to route a real driving path between. Multiple pairs per region for
# variety across repeated "random road" calls.
_WAYPOINT_PAIRS: List[Tuple[str, Tuple[float, float], Tuple[float, float]]] = [
    ("San Francisco, California, USA", (37.774, -122.419), (37.784, -122.409)),
    ("San Francisco, California, USA", (37.765, -122.435), (37.775, -122.422)),
    ("Golden, Colorado, USA", (39.739, -105.227), (39.729, -105.217)),
    ("Golden, Colorado, USA", (39.735, -105.238), (39.745, -105.223)),
    ("Manhattan, New York, USA", (40.758, -73.986), (40.768, -73.976)),
    ("Chicago Loop, Illinois, USA", (41.878, -87.630), (41.888, -87.620)),
    ("Seattle, Washington, USA", (47.606, -122.332), (47.616, -122.322)),
    ("Big Sur, California, USA", (36.270, -121.808), (36.260, -121.798)),
]

_session = requests.Session()
_session.mount("https://", requests.adapters.HTTPAdapter(max_retries=0))
_session.mount("http://", requests.adapters.HTTPAdapter(max_retries=0))


def _route(a: Tuple[float, float], b: Tuple[float, float]) -> Optional[dict]:
    if not config.USE_LIVE_OSRM:
        return None
    url = f"{config.OSRM_URL}/{a[1]},{a[0]};{b[1]},{b[0]}"
    try:
        resp = _session.get(
            url,
            params={"overview": "full", "geometries": "geojson", "steps": "true"},
            timeout=(min(3.0, config.OSRM_TIMEOUT_S), config.OSRM_TIMEOUT_S),
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            return None
        return data
    except Exception as exc:
        log.warning("OSRM route request failed: %s", exc)
        return None


MAX_VERTEX_GAP_M = 20.0


def _densify(points: List[Tuple[float, float]], max_gap_m: float) -> List[Tuple[float, float]]:
    """OSRM's `overview=full` geometry is Douglas-Peucker-simplified — straight
    stretches collapse to just their two endpoints, which can be 100m+ apart on a
    long straight while a switchback right next to it gets a point every few
    meters. buildPath/guardrail/tree placement on the frontend all treat
    consecutive road points as roughly evenly spaced; a single 150m+ jump between
    vertices rendered as one giant straight segment next to a dense tight cluster,
    which read as the road visually breaking/teleporting rather than one
    continuous path. Linear lat/lon interpolation is plenty accurate at these
    sub-200m gap sizes."""
    if len(points) < 2:
        return points
    out = [points[0]]
    for i in range(1, len(points)):
        a, b = points[i - 1], points[i]
        d = haversine_m(*a, *b)
        steps = max(1, math.ceil(d / max_gap_m))
        for s in range(1, steps + 1):
            t = s / steps
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def _truncate(points: List[Tuple[float, float]], max_m: float) -> List[Tuple[float, float]]:
    if len(points) < 2:
        return points
    out = [points[0]]
    total = 0.0
    for i in range(1, len(points)):
        d = haversine_m(*points[i - 1], *points[i])
        if total + d > max_m:
            break
        total += d
        out.append(points[i])
    return out


def _route_to_road(data: dict, region: str, route_id: str) -> Optional[RawRoad]:
    route = data["routes"][0]
    coords = route["geometry"]["coordinates"]  # [lon, lat] pairs
    if len(coords) < 3:
        return None
    truncated = _truncate([(lat, lon) for lon, lat in coords], MAX_ROUTE_LENGTH_M)
    points = _densify(truncated, MAX_VERTEX_GAP_M)
    if len(points) < 3:
        return None
    kept_length_m = polyline_length_m(points)

    # Real street names come from turn-by-turn step metadata. Only consider steps
    # that actually fall within the (possibly truncated) rendered segment — picking
    # a name from a maneuver past the cut point would label the scene with a street
    # it doesn't actually show, undermining the whole "labeled honestly" premise.
    all_steps = [s for leg in route.get("legs", []) for s in leg.get("steps", [])]
    steps, cum = [], 0.0
    for s in all_steps:
        if cum >= kept_length_m:
            break
        steps.append(s)
        cum += s.get("distance", 0)
    named_steps = [s for s in steps if s.get("name")]
    name = max(named_steps, key=lambda s: s.get("distance", 0))["name"] if named_steps else f"Real Route ({region})"

    return RawRoad(
        osm_id=f"osrm:{route_id}", name=name, region=region, points=points,
        tags=dict(highway=None, lanes=None, maxspeed_kmh=None, oneway=False,
                   surface=None, lit=None, sidewalk=None, bridge=False),
        nearby_signals=[], nearby_crossings=[], nearby_schools=[], nearby_hospitals=[],
        water_nearby=False, guardrail_present=False,
        # Each turn-by-turn step ends at a maneuver point — a reasonable proxy for
        # intersections actually crossed along a real route, absent Overpass's
        # direct node-tag context.
        intersections=max(1, len(steps) - 1),
        slope_pct=None,
        source="osrm",
        building_footprints=[],
    )


class OSRMProvider(RoadDataProvider):
    name = "osrm"

    def get_random_road(self) -> Optional[RawRoad]:
        # Both waypoints are fixed per pair, so OSRM routes the identical
        # polyline every time a given pair is used — the id has to be derived
        # from the pair's own stable position in _WAYPOINT_PAIRS, never a
        # random suffix, or re-scanning the same real route (a near-certainty
        # across repeated "random" picks from only 8 pairs) mints a fresh id
        # each time and looks like a distinct duplicate road in road_db/the
        # Priority Map instead of updating the one real entry for it.
        indices = list(range(len(_WAYPOINT_PAIRS)))
        random.shuffle(indices)
        for idx in indices[:3]:
            region, a, b = _WAYPOINT_PAIRS[idx]
            data = _route(a, b)
            if not data:
                continue
            coords = data["routes"][0]["geometry"]["coordinates"]
            length = polyline_length_m([(lat, lon) for lon, lat in coords])
            if length < 40:
                continue
            return _route_to_road(data, region, str(idx))
        return None

    def get_road(self, road_id: str) -> Optional[RawRoad]:
        # OSRM routes aren't independently re-fetchable by id (no stable server-side
        # id for a route) — callers rely on the in-memory road_store cache instead,
        # exactly like a freshly-scanned OSM way does before it's cached.
        return None

    def list_roads(self) -> List[RawRoad]:
        # Same stable per-pair id scheme as get_random_road — a route discovered
        # through either method resolves to the same road_db row.
        out: List[RawRoad] = []
        for idx, (region, a, b) in enumerate(_WAYPOINT_PAIRS[:4]):
            data = _route(a, b)
            if not data:
                continue
            road = _route_to_road(data, region, str(idx))
            if road:
                out.append(road)
        return out
