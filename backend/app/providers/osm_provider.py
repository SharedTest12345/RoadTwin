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

# The 6 regions above cluster in just a few metro areas — fine for a handful
# of scans, but "random road" always picks from REGIONS, so at any volume
# (e.g. scanning hundreds of roads) every result lands in one of those same 6
# small boxes, rendering as a few dense clusters on the Atlas map instead of
# spread across the country. These extend coverage to every major US region
# (Pacific NW, California, Mountain West, Southwest, Midwest, Texas, South,
# Southeast, Mid-Atlantic, Northeast) so repeated scans actually scatter
# nationwide. Each is still a real downtown-sized area (~3km across) so
# Overpass/OSRM return real, richly-tagged streets rather than empty
# countryside.
_HALF_SPAN_LAT = 0.016
_HALF_SPAN_LON = 0.020
_MORE_CITY_CENTERS: List[Tuple[str, float, float]] = [
    ("Portland, Oregon, USA", 45.520, -122.675),
    ("Oakland, California, USA", 37.804, -122.271),
    ("Sacramento, California, USA", 38.581, -121.494),
    ("Los Angeles, California, USA", 34.052, -118.244),
    ("San Diego, California, USA", 32.716, -117.161),
    ("Fresno, California, USA", 36.746, -119.772),
    ("Denver, Colorado, USA", 39.739, -104.990),
    ("Phoenix, Arizona, USA", 33.448, -112.074),
    ("Tucson, Arizona, USA", 32.222, -110.974),
    ("Las Vegas, Nevada, USA", 36.171, -115.139),
    ("Salt Lake City, Utah, USA", 40.760, -111.891),
    ("Albuquerque, New Mexico, USA", 35.085, -106.649),
    ("Boise, Idaho, USA", 43.615, -116.202),
    ("Billings, Montana, USA", 45.783, -108.500),
    ("Minneapolis, Minnesota, USA", 44.977, -93.265),
    ("Detroit, Michigan, USA", 42.331, -83.046),
    ("St. Louis, Missouri, USA", 38.627, -90.199),
    ("Kansas City, Missouri, USA", 39.100, -94.578),
    ("Cleveland, Ohio, USA", 41.499, -81.694),
    ("Columbus, Ohio, USA", 39.961, -82.999),
    ("Indianapolis, Indiana, USA", 39.768, -86.158),
    ("Milwaukee, Wisconsin, USA", 43.039, -87.906),
    ("Omaha, Nebraska, USA", 41.257, -95.995),
    ("Houston, Texas, USA", 29.760, -95.370),
    ("Dallas, Texas, USA", 32.777, -96.797),
    ("Austin, Texas, USA", 30.267, -97.743),
    ("San Antonio, Texas, USA", 29.424, -98.494),
    ("New Orleans, Louisiana, USA", 29.951, -90.072),
    ("Oklahoma City, Oklahoma, USA", 35.468, -97.516),
    ("Little Rock, Arkansas, USA", 34.746, -92.289),
    ("Atlanta, Georgia, USA", 33.749, -84.388),
    ("Miami, Florida, USA", 25.762, -80.192),
    ("Orlando, Florida, USA", 28.538, -81.379),
    ("Tampa, Florida, USA", 27.950, -82.457),
    ("Charlotte, North Carolina, USA", 35.227, -80.843),
    ("Raleigh, North Carolina, USA", 35.780, -78.639),
    ("Nashville, Tennessee, USA", 36.163, -86.782),
    ("Memphis, Tennessee, USA", 35.150, -90.049),
    ("Birmingham, Alabama, USA", 33.521, -86.802),
    ("Boston, Massachusetts, USA", 42.361, -71.058),
    ("Philadelphia, Pennsylvania, USA", 39.953, -75.164),
    ("Washington, District of Columbia, USA", 38.907, -77.037),
    ("Baltimore, Maryland, USA", 39.290, -76.612),
    ("Pittsburgh, Pennsylvania, USA", 40.441, -79.996),
    ("Providence, Rhode Island, USA", 41.824, -71.413),
    ("Buffalo, New York, USA", 42.886, -78.878),
    # Remaining states with no city above — without these, whole states show
    # zero markers on the Atlas map regardless of how many roads get scanned,
    # which reads as "the US isn't covered" no matter the scan count.
    ("Hartford, Connecticut, USA", 41.764, -72.685),
    ("Wilmington, Delaware, USA", 39.745, -75.547),
    ("Des Moines, Iowa, USA", 41.586, -93.625),
    ("Wichita, Kansas, USA", 37.688, -97.336),
    ("Louisville, Kentucky, USA", 38.253, -85.758),
    ("Portland, Maine, USA", 43.661, -70.255),
    ("Jackson, Mississippi, USA", 32.299, -90.185),
    ("Manchester, New Hampshire, USA", 42.996, -71.455),
    ("Newark, New Jersey, USA", 40.735, -74.172),
    ("Fargo, North Dakota, USA", 46.877, -96.789),
    ("Columbia, South Carolina, USA", 34.000, -81.035),
    ("Sioux Falls, South Dakota, USA", 43.545, -96.731),
    ("Burlington, Vermont, USA", 44.476, -73.212),
    ("Richmond, Virginia, USA", 37.541, -77.436),
    ("Charleston, West Virginia, USA", 38.349, -81.633),
    ("Cheyenne, Wyoming, USA", 41.140, -104.820),
    ("Anchorage, Alaska, USA", 61.218, -149.900),
    ("Honolulu, Hawaii, USA", 21.307, -157.858),
]
REGIONS += [
    (name, (lat - _HALF_SPAN_LAT, lon - _HALF_SPAN_LON, lat + _HALF_SPAN_LAT, lon + _HALF_SPAN_LON))
    for name, lat, lon in _MORE_CITY_CENTERS
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
      way["natural"="coastline"]({b});
      way["waterway"~"^(river|riverbank|stream)$"]({b});
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
            elif tags.get("natural") in ("water", "coastline") or tags.get("waterway") in ("river", "riverbank", "stream"):
                # "natural=water" alone misses the two most common real
                # drop-off hazards: an ocean-adjacent road (tagged
                # natural=coastline, a different tag from an inland lake)
                # and a riverside road (waterway=river/riverbank) — both are
                # exactly the kind of edge a guardrail exists for, and both
                # were previously invisible to water_nearby.
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
