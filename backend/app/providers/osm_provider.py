"""Live OpenStreetMap road discovery via the Overpass API. No API key required.
Any network failure, timeout, or empty result must degrade gracefully — callers
fall back to DemoProvider, never crash.

Performance note: this used to issue up to 2 sequential Overpass calls per region
tried (ways, then a second "context" call scoped to the chosen way) across up to 3
regions — worst case ~6 round trips at a 12s timeout each, which could exceed 60s
before falling back. It now issues exactly ONE combined query per region (roads +
signals + crossings + schools/hospitals + water + guardrails, all in one bbox), and
filters context to each candidate road locally in Python — no second network call."""
import logging
import random
import time
from typing import List, Optional, Tuple

import requests

from .. import config
from .base import RoadDataProvider, RawRoad
from ..services.geometry import polyline_length_m, point_near_polyline, project_local_xy

log = logging.getLogger("roadtwin.osm")

HIGHWAY_CLASSES = "primary|secondary|tertiary|residential|trunk|unclassified|living_street"

# Curated real-world regions used for "random road" discovery. Kept small (~3-4km
# across) so a single Overpass query returns quickly — a full-city bbox can hold
# thousands of ways and take 10s+ to process server-side.
REGIONS = [
    ("San Francisco, California, USA", (37.760, -122.450, 37.790, -122.415)),
    ("Big Sur, California, USA", (36.245, -121.810, 36.280, -121.775)),
    ("Manhattan, New York, USA", (40.755, -73.990, 40.780, -73.960)),
    ("Golden, Colorado, USA", (39.720, -105.245, 39.750, -105.210)),
    ("Chicago Loop, Illinois, USA", (41.870, -87.640, 41.895, -87.615)),
    ("Seattle, Washington, USA", (47.600, -122.350, 47.625, -122.320)),
]


class HostUnreachable(Exception):
    """Raised when the Overpass host itself can't be reached (DNS/connect/TLS
    failure) as opposed to a slow or empty response. Distinguishing this lets
    callers stop retrying other regions against the same dead host immediately,
    instead of waiting out the full timeout N more times."""


# max_retries=0: urllib3's default transparent retry-on-connect doubles the wait
# before a connect timeout surfaces. We already have our own region-level fallback,
# so a silent extra retry here only slows down the "give up and use demo data" path.
_session = requests.Session()
_adapter = requests.adapters.HTTPAdapter(max_retries=0)
_session.mount("https://", _adapter)
_session.mount("http://", _adapter)


# A single "scan random road" call can fire off several Overpass queries in
# quick succession (osm_provider's own region retries, osrm_provider's
# building/side-road enrichment on top of THAT) — once one of them has
# actually timed out proving the host is unreachable, the rest of that same
# burst have nothing new to learn from paying the same ~3s connect timeout
# again. This is what made "scan a new road" (retrying several times to
# avoid a duplicate) take tens of seconds end to end even though every
# individual call was already failing fast on its own.
_overpass_down_until = 0.0
_OVERPASS_DOWN_COOLDOWN_S = 20.0


def _overpass(query: str) -> Optional[dict]:
    if not config.USE_LIVE_OSM:
        return None
    global _overpass_down_until
    if time.time() < _overpass_down_until:
        raise HostUnreachable("Overpass recently detected unreachable (cooldown)")
    try:
        # Fail the TCP handshake fast (host down/unreachable); allow more time for
        # the server to actually compute and return a response once connected.
        resp = _session.post(config.OVERPASS_URL, data={"data": query},
                              timeout=(min(3.0, config.OVERPASS_TIMEOUT_S), config.OVERPASS_TIMEOUT_S))
        resp.raise_for_status()
        return resp.json()
    except (requests.exceptions.ConnectTimeout, requests.exceptions.ConnectionError) as exc:
        log.warning("Overpass host unreachable: %s", exc)
        _overpass_down_until = time.time() + _OVERPASS_DOWN_COOLDOWN_S
        raise HostUnreachable(str(exc)) from exc
    except Exception as exc:
        log.warning("Overpass query failed: %s", exc)
        return None


def _bbox_str(b: Tuple[float, float, float, float]) -> str:
    return f"{b[0]},{b[1]},{b[2]},{b[3]}"


def _combined_query(bbox) -> str:
    b = _bbox_str(bbox)
    t = int(config.OVERPASS_TIMEOUT_S)
    return f"""
    [out:json][timeout:{t}];
    (
      way["highway"~"^({HIGHWAY_CLASSES})$"]["area"!="yes"]({b});
      node["highway"="traffic_signals"]({b});
      node["highway"="crossing"]({b});
      node["amenity"="school"]({b});
      node["amenity"="hospital"]({b});
      way["natural"="water"]({b});
      node["natural"="water"]({b});
      way["barrier"="guard_rail"]({b});
      node["barrier"="guard_rail"]({b});
      way["building"]({b});
    );
    out geom;
    """


def _way_to_road(el: dict, region: str) -> Optional[RawRoad]:
    geom = el.get("geometry")
    if not geom or len(geom) < 3:
        return None
    points = [(g["lat"], g["lon"]) for g in geom]
    tags = el.get("tags", {})
    lanes = None
    try:
        lanes = int(float(tags.get("lanes"))) if tags.get("lanes") else None
    except (ValueError, TypeError):
        lanes = None
    maxspeed = None
    if tags.get("maxspeed"):
        raw = str(tags["maxspeed"]).replace("mph", "").strip()
        try:
            v = float(raw)
            maxspeed = v * 1.60934 if "mph" in str(tags["maxspeed"]) else v
        except ValueError:
            maxspeed = None
    lit = None
    if "lit" in tags:
        lit = tags["lit"] == "yes"
    return RawRoad(
        osm_id=f"osm:{el['id']}", name=tags.get("name") or f"Unnamed {tags.get('highway', 'road').title()}",
        region=region, points=points,
        tags=dict(highway=tags.get("highway", "unclassified"), lanes=lanes, maxspeed_kmh=maxspeed,
                   oneway=tags.get("oneway") == "yes", surface=tags.get("surface"), lit=lit,
                   sidewalk=tags.get("sidewalk"), bridge=tags.get("bridge") == "yes"),
        nearby_signals=[], nearby_crossings=[], nearby_schools=[], nearby_hospitals=[],
        water_nearby=False, guardrail_present=False, intersections=0, slope_pct=None,
        source="osm",
    )


class _ContextPool:
    """All context elements for a region, fetched once alongside the ways. Filtering
    to a specific road's vicinity happens locally (no extra HTTP round trip)."""

    def __init__(self, elements: list):
        self.signals: List[Tuple[float, float]] = []
        self.crossings: List[Tuple[float, float]] = []
        self.schools: List[Tuple[float, float]] = []
        self.hospitals: List[Tuple[float, float]] = []
        self.water_points: List[Tuple[float, float]] = []
        self.guardrail_points: List[Tuple[float, float]] = []
        self.building_footprints: List[List[Tuple[float, float]]] = []
        # (way id, polyline) — id kept so enrich() can exclude a road's own way
        # from its own "nearby ways" list (every candidate road's way is ALSO
        # present in this same pool, since the combined query fetches every
        # highway in the bbox, itself included).
        self.highway_ways: List[Tuple[Optional[int], List[Tuple[float, float]]]] = []
        for el in elements:
            tags = el.get("tags", {})
            if el.get("type") == "way" and "building" in tags:
                geom = el.get("geometry")
                if geom and len(geom) >= 3:
                    self.building_footprints.append([(g["lat"], g["lon"]) for g in geom])
                continue
            if el.get("type") == "way" and "highway" in tags:
                geom = el.get("geometry")
                if geom and len(geom) >= 2:
                    self.highway_ways.append((el.get("id"), [(g["lat"], g["lon"]) for g in geom]))
                continue
            lat = el.get("lat")
            lon = el.get("lon")
            if lat is None or lon is None:
                geom = el.get("geometry")
                if geom:
                    lat, lon = geom[len(geom) // 2]["lat"], geom[len(geom) // 2]["lon"]
                else:
                    continue
            if tags.get("highway") == "traffic_signals":
                self.signals.append((lat, lon))
            elif tags.get("highway") == "crossing":
                self.crossings.append((lat, lon))
            elif tags.get("amenity") == "school":
                self.schools.append((lat, lon))
            elif tags.get("amenity") == "hospital":
                self.hospitals.append((lat, lon))
            elif tags.get("natural") == "water":
                self.water_points.append((lat, lon))
            elif tags.get("barrier") == "guard_rail":
                self.guardrail_points.append((lat, lon))

    def enrich(self, road: RawRoad, radius_m: float = 180.0) -> RawRoad:
        xy_road = project_local_xy(road["points"])

        def nearby(pool: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
            if not pool:
                return []
            xy_pool = project_local_xy(road["points"] + pool)[len(road["points"]):]
            return [pt for pt, xy in zip(pool, xy_pool) if point_near_polyline(xy, xy_road, radius_m)]

        signals = nearby(self.signals)
        crossings = nearby(self.crossings)
        road["nearby_signals"] = signals
        road["nearby_crossings"] = crossings
        road["nearby_schools"] = nearby(self.schools)
        road["nearby_hospitals"] = nearby(self.hospitals)
        road["water_nearby"] = len(nearby(self.water_points)) > 0
        road["guardrail_present"] = len(nearby(self.guardrail_points)) > 0
        road["intersections"] = max(1, len(signals) + len(crossings) // 2)

        footprints = []
        for ring in self.building_footprints:
            centroid = (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
            [cxy] = project_local_xy(road["points"] + [centroid])[len(road["points"]):]
            if point_near_polyline(cxy, xy_road, radius_m):
                footprints.append(ring)
        # Cap payload size — a dense city block can return hundreds of footprints,
        # most of it more detail than this scene needs at road-segment scale.
        road["building_footprints"] = footprints[:60]

        # A much tighter radius than the 180m default above — this is asking
        # "does this street actually MEET ours" (a real junction), not "is it
        # somewhere in the neighborhood" the way a school/signal reasonably can
        # be. feature_extraction.py does the exact trim-to-a-stub-at-the-real-
        # junction-point work; this only needs to hand it real candidates.
        JUNCTION_RADIUS_M = 18.0
        own_way_id: Optional[int] = None
        if road["osm_id"].startswith("osm:"):
            try:
                own_way_id = int(road["osm_id"].split(":", 1)[1])
            except ValueError:
                own_way_id = None
        nearby_ways: List[List[Tuple[float, float]]] = []
        for way_id, way_latlon in self.highway_ways:
            if way_id == own_way_id or len(way_latlon) < 2:
                continue
            way_xy = project_local_xy(road["points"] + way_latlon)[len(road["points"]):]
            if any(point_near_polyline(xy, xy_road, JUNCTION_RADIUS_M) for xy in way_xy):
                nearby_ways.append(way_latlon)
        road["nearby_ways"] = nearby_ways[:30]
        return road


def _candidates_from_query(data: dict, region_name: str) -> Tuple[List[RawRoad], _ContextPool]:
    pool = _ContextPool(data.get("elements", []))
    candidates = []
    for el in data.get("elements", []):
        if el.get("type") != "way" or "highway" not in el.get("tags", {}):
            continue
        road = _way_to_road(el, region_name)
        if not road:
            continue
        length = polyline_length_m(road["points"])
        if 80 <= length <= 2500:
            candidates.append(road)
    return candidates, pool


class OSMProvider(RoadDataProvider):
    name = "osm"

    def get_random_road(self) -> Optional[RawRoad]:
        regions = REGIONS[:]
        random.shuffle(regions)
        for region_name, bbox in regions[:3]:
            try:
                data = _overpass(_combined_query(bbox))
            except HostUnreachable:
                break  # host is down — trying other regions against it won't help
            if not data or not data.get("elements"):
                continue
            candidates, pool = _candidates_from_query(data, region_name)
            if candidates:
                road = random.choice(candidates)
                return pool.enrich(road)
        return None

    def get_road(self, road_id: str) -> Optional[RawRoad]:
        if not road_id.startswith("osm:"):
            return None
        way_id = road_id.split(":", 1)[1]
        try:
            data = _overpass(f'[out:json][timeout:{int(config.OVERPASS_TIMEOUT_S)}]; way({way_id}); out geom;')
        except HostUnreachable:
            return None
        if not data or not data.get("elements"):
            return None
        road = _way_to_road(data["elements"][0], "OpenStreetMap")
        if not road:
            return None
        bbox = (min(p[0] for p in road["points"]) - 0.002, min(p[1] for p in road["points"]) - 0.002,
                max(p[0] for p in road["points"]) + 0.002, max(p[1] for p in road["points"]) + 0.002)
        try:
            ctx_data = _overpass(_combined_query(bbox))
        except HostUnreachable:
            ctx_data = None
        if ctx_data:
            pool = _ContextPool(ctx_data.get("elements", []))
            road = pool.enrich(road)
        return road

    def list_roads(self) -> List[RawRoad]:
        out: List[RawRoad] = []
        regions = REGIONS[:]
        random.shuffle(regions)
        for region_name, bbox in regions[:2]:
            try:
                data = _overpass(_combined_query(bbox))
            except HostUnreachable:
                break
            if not data:
                continue
            candidates, pool = _candidates_from_query(data, region_name)
            for road in candidates[:4]:
                out.append(pool.enrich(road))
        return out
