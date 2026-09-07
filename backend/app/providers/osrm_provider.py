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
from dataclasses import dataclass
from typing import List, Optional, Tuple

import requests

from .. import config
from .base import RoadDataProvider, RawRoad
from . import osm_provider
from .osm_provider import HIGHWAY_CLASSES, HostUnreachable
from ..services.geometry import polyline_length_m, haversine_m, point_near_polyline, project_local_xy

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

# Same curated real-world areas OSMProvider uses for "random road" discovery
# (osm_provider.REGIONS). Waypoints are jittered randomly inside whichever
# bbox is picked, NOT read from a fixed list of pairs — a fixed list of N
# pairs caps "random road" at N possible roads ever, since each pair routes
# the identical polyline every time. (This is exactly what happened: a prior
# fixed pool of 8 pairs got fully scanned, and road_store correctly refused to
# re-offer any of them as "new" — so scanning silently hit a hard ceiling.)
# Random points inside a ~3-4km bbox give effectively unlimited distinct
# routes instead.
MIN_WAYPOINT_SEPARATION_M = 300.0


def _random_waypoint_pair(bbox: Tuple[float, float, float, float]) -> Tuple[Tuple[float, float], Tuple[float, float]]:
    min_lat, min_lon, max_lat, max_lon = bbox
    a = (random.uniform(min_lat, max_lat), random.uniform(min_lon, max_lon))
    b = (random.uniform(min_lat, max_lat), random.uniform(min_lon, max_lon))
    for _ in range(5):
        if haversine_m(a[0], a[1], b[0], b[1]) >= MIN_WAYPOINT_SEPARATION_M:
            break
        b = (random.uniform(min_lat, max_lat), random.uniform(min_lon, max_lon))
    return a, b

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
    except (requests.exceptions.ConnectTimeout, requests.exceptions.ConnectionError) as exc:
        # Same distinction osm_provider.py's _overpass() makes: the OSRM host
        # itself being unreachable means retrying the OTHER waypoint pairs in
        # the same call is pointless (same dead host) — reusing its
        # HostUnreachable lets get_random_road()/list_roads() below break out
        # of their own retry loops immediately instead of paying a full
        # connect timeout per remaining pair.
        log.warning("OSRM host unreachable: %s", exc)
        raise HostUnreachable(str(exc)) from exc
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


# Same cap osm_provider.py uses for its own building_footprints — keeps the
# payload/scene prop count bounded regardless of how dense the area is.
BUILDING_FETCH_CAP = 60
# Real incoming/side streets are worth fewer of, and feature_extraction.py's
# own junction proximity filter throws most non-junction candidates away
# anyway — this just bounds how many candidate ways get sent over the wire.
WAY_FETCH_CAP = 30
# Matches osm_provider.py's own _ContextPool.enrich() radius_m default — same
# "is this actually near the road, not just somewhere in the query bbox" cut.
CONTEXT_RADIUS_M = 180.0


@dataclass
class _RouteContext:
    buildings: List[List[Tuple[float, float]]]
    ways: List[List[Tuple[float, float]]]
    signals: List[Tuple[float, float]]
    crossings: List[Tuple[float, float]]
    schools: List[Tuple[float, float]]
    hospitals: List[Tuple[float, float]]
    water_nearby: bool
    guardrail_present: bool


_EMPTY_CONTEXT = _RouteContext([], [], [], [], [], [], False, False)


def _fetch_context_near_route(points: List[Tuple[float, float]]) -> _RouteContext:
    """This provider exists specifically because Overpass (osm_provider.py) is
    unreliable — but that unreliability applies to its big REGION-WIDE discovery
    query, not necessarily to a single small query scoped to just this route's own
    bounding box. Real building footprints, real neighboring streets (for the
    incoming/side-roads feature), AND real signal/crossing/school/hospital/water/
    guardrail context are all worth trying for over the always-hardcoded-empty
    this used to give every OSRM-sourced road — the practical effect being that a
    searched-by-name route along an actual coastal cliff (e.g. a Highway-1-style
    road with no OSM guard_rail tag) silently scored as if it were flat, inland,
    and signal-free, because this provider never even asked. One combined query
    (not several) for the same reason osm_provider.py's own _combined_query is one
    call — same tag set as that query, just scoped to this route's own small bbox
    instead of a whole discovery region. Best-effort and silent on any failure —
    decoration and hazard context alike; the route itself must never depend on it.
    Routed through osm_provider._overpass() (not a second bespoke POST here) so
    this also gets its shared "Overpass just proved unreachable" cooldown for
    free — without it, a road_store retry burst that already gave up on OSM's own
    Overpass call would still pay a full fresh connect timeout HERE for every
    OSRM candidate it evaluates in the same burst."""
    if not config.USE_LIVE_OSM or len(points) < 2:
        return _EMPTY_CONTEXT
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    # ~150m buffer in degrees around the route's own bounding box — rough (not
    # latitude-corrected), which is fine for a decoration-only query rather than
    # a precision boundary.
    pad_lat, pad_lon = 0.0014, 0.0018
    bbox = (min(lats) - pad_lat, min(lons) - pad_lon, max(lats) + pad_lat, max(lons) + pad_lon)
    b = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}"
    query = f"""
    [out:json][timeout:{int(config.OVERPASS_TIMEOUT_S)}];
    (
      way["building"]({b});
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
    );
    out geom;
    """
    try:
        data = osm_provider._overpass(query)
    except HostUnreachable as exc:
        log.warning("Overpass context fetch skipped (non-fatal, route unaffected): %s", exc)
        return _EMPTY_CONTEXT
    if not data:
        return _EMPTY_CONTEXT

    buildings: List[List[Tuple[float, float]]] = []
    ways: List[List[Tuple[float, float]]] = []
    signals: List[Tuple[float, float]] = []
    crossings: List[Tuple[float, float]] = []
    schools: List[Tuple[float, float]] = []
    hospitals: List[Tuple[float, float]] = []
    water_points: List[List[Tuple[float, float]]] = []
    guardrail_points: List[List[Tuple[float, float]]] = []

    for el in data.get("elements", []):
        tags = el.get("tags", {})
        geom = el.get("geometry")
        if geom and len(geom) >= 1:
            pts = [(g["lat"], g["lon"]) for g in geom]
        elif el.get("lat") is not None and el.get("lon") is not None:
            pts = [(el["lat"], el["lon"])]
        else:
            continue
        point = pts[len(pts) // 2]  # single representative point for node-like context

        if "building" in tags:
            if len(pts) >= 3:
                buildings.append(pts)
        elif tags.get("highway") == "traffic_signals":
            signals.append(point)
        elif tags.get("highway") == "crossing":
            crossings.append(point)
        elif tags.get("amenity") == "school":
            schools.append(point)
        elif tags.get("amenity") == "hospital":
            hospitals.append(point)
        elif "highway" in tags:  # a real road class, matched by HIGHWAY_CLASSES above
            if len(pts) >= 2:
                ways.append(pts)
        elif tags.get("natural") in ("water", "coastline") or tags.get("waterway") in ("river", "riverbank", "stream"):
            water_points.append(pts)
        elif tags.get("barrier") == "guard_rail":
            guardrail_points.append(pts)

    # Distance-filter everything against the route's own line (not just "was in
    # the padded bbox") — same point_near_polyline check osm_provider.py's
    # _ContextPool.enrich() uses, reprojected into one shared local frame per call.
    xy_route = project_local_xy(points)

    def _near(pts: List[Tuple[float, float]]) -> bool:
        elem_xy = project_local_xy(points + pts)[len(points):]
        return any(point_near_polyline(xy, xy_route, CONTEXT_RADIUS_M) for xy in elem_xy)

    def _filter_points(pool: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
        return [p for p in pool if _near([p])]

    return _RouteContext(
        buildings=buildings[:BUILDING_FETCH_CAP],
        ways=ways[:WAY_FETCH_CAP],
        signals=_filter_points(signals),
        crossings=_filter_points(crossings),
        schools=_filter_points(schools),
        hospitals=_filter_points(hospitals),
        water_nearby=any(_near(pts) for pts in water_points),
        guardrail_present=any(_near(pts) for pts in guardrail_points),
    )


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

    ctx = _fetch_context_near_route(points)
    return RawRoad(
        osm_id=f"osrm:{route_id}", name=name, region=region, points=points,
        tags=dict(highway=None, lanes=None, maxspeed_kmh=None, oneway=False,
                   surface=None, lit=None, sidewalk=None, bridge=False),
        nearby_signals=ctx.signals, nearby_crossings=ctx.crossings,
        nearby_schools=ctx.schools, nearby_hospitals=ctx.hospitals,
        water_nearby=ctx.water_nearby, guardrail_present=ctx.guardrail_present,
        # Each turn-by-turn step ends at a maneuver point — a reasonable proxy for
        # intersections actually crossed along a real route, absent Overpass's
        # direct node-tag context.
        intersections=max(1, len(steps) - 1),
        slope_pct=None,
        source="osrm",
        building_footprints=ctx.buildings,
        nearby_ways=ctx.ways,
    )


class OSRMProvider(RoadDataProvider):
    name = "osrm"

    def get_random_road(self) -> Optional[RawRoad]:
        regions = list(osm_provider.REGIONS)
        random.shuffle(regions)
        for region, bbox in regions[:3]:
            a, b = _random_waypoint_pair(bbox)
            try:
                data = _route(a, b)
            except HostUnreachable:
                break  # host is down — trying other regions against it won't help
            if not data:
                continue
            coords = data["routes"][0]["geometry"]["coordinates"]
            length = polyline_length_m([(lat, lon) for lon, lat in coords])
            if length < 40:
                continue
            # Id derived from the actual waypoints queried, not a fixed slot —
            # two random draws landing on the same coordinates again is
            # effectively impossible, so this is naturally unique per real
            # route while still resolving to the same road_db row in the rare
            # case it ever did repeat exactly.
            route_id = f"{a[0]:.4f}_{a[1]:.4f}-{b[0]:.4f}_{b[1]:.4f}"
            return _route_to_road(data, region, route_id)
        return None

    def get_road(self, road_id: str) -> Optional[RawRoad]:
        # OSRM routes aren't independently re-fetchable by id (no stable server-side
        # id for a route) — callers rely on the in-memory road_store cache instead,
        # exactly like a freshly-scanned OSM way does before it's cached.
        return None

    def list_roads(self) -> List[RawRoad]:
        # Same id scheme as get_random_road — a route discovered through
        # either method resolves to the same road_db row.
        out: List[RawRoad] = []
        for region, bbox in list(osm_provider.REGIONS)[:4]:
            a, b = _random_waypoint_pair(bbox)
            try:
                data = _route(a, b)
            except HostUnreachable:
                break  # host is down — trying other regions against it won't help
            if not data:
                continue
            route_id = f"{a[0]:.4f}_{a[1]:.4f}-{b[0]:.4f}_{b[1]:.4f}"
            road = _route_to_road(data, region, route_id)
            if road:
                out.append(road)
        return out
