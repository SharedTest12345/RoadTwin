"""Turns a RawRoad (from any provider) into typed geometry + features.
Every value that is not directly sourced from OSM/provider tags is tracked
in `estimated` so the UI can label it honestly."""
import math
from typing import List, Tuple

from ..models.schemas import RoadGeometry, RoadFeatures, LatLng, SideRoad
from ..providers.base import RawRoad, DEFAULT_SPEED_KMH, DEFAULT_VOLUME_VPH
from .geometry import polyline_length_m, project_ref, curvature_stats
from . import accident_data

# A candidate street's own nearest point to our route has to land within this
# to actually count as meeting it (a real junction) rather than just passing
# nearby — providers already pre-filter to roughly this scale (see
# osm_provider.py's JUNCTION_RADIUS_M / osrm_provider.py's bbox query), this
# is the precise cut a stub is actually built from.
SIDE_ROAD_JUNCTION_RADIUS_M = 20.0
# How far the rendered stub extends on EACH side of the junction point.
SIDE_ROAD_STUB_HALF_LEN_M = 45.0
SIDE_ROAD_MAX = 4


def _nearest_point_on_xy(x: float, y: float, xy: List[Tuple[float, float]]) -> float:
    """Vertex-distance approximation (consistent with geometry.py's own
    point_near_polyline) — good enough at the point densities real OSM/OSRM
    geometry actually comes in at, without a full point-to-segment projection."""
    return min(math.hypot(x - px, y - py) for px, py in xy)


def _trim_stub(way_xy: List[Tuple[float, float]], junction_idx: int, half_len_m: float) -> Tuple[List[Tuple[float, float]], int]:
    """A short window of `way_xy` centered on `junction_idx`, extending up to
    `half_len_m` of real arc length in each direction — naturally shorter on
    a side that dead-ends near the junction, and reaches its full length on a
    through street. Kept in the candidate way's OWN point order throughout."""
    back: List[Tuple[float, float]] = []
    acc, i = 0.0, junction_idx
    while i > 0 and acc < half_len_m:
        acc += math.hypot(way_xy[i][0] - way_xy[i - 1][0], way_xy[i][1] - way_xy[i - 1][1])
        i -= 1
        back.append(way_xy[i])
    back.reverse()

    fwd: List[Tuple[float, float]] = []
    acc, i = 0.0, junction_idx
    while i < len(way_xy) - 1 and acc < half_len_m:
        acc += math.hypot(way_xy[i][0] - way_xy[i + 1][0], way_xy[i][1] - way_xy[i + 1][1])
        i += 1
        fwd.append(way_xy[i])

    # `back` was built walking AWAY from the junction then reversed, so its
    # length is exactly the junction's own index in the concatenated result.
    stub = back + [way_xy[junction_idx]] + fwd
    return stub, len(back)


def _extract_side_roads(
    main_xy: List[Tuple[float, float]],
    nearby_ways: List[List[Tuple[float, float]]],
    ref_lat: float, ref_lon: float,
) -> List[SideRoad]:
    out: List[SideRoad] = []
    for way_latlon in nearby_ways:
        if len(way_latlon) < 2:
            continue
        way_xy = project_ref(way_latlon, ref_lat, ref_lon)
        best_i, best_d = None, None
        for i, (x, y) in enumerate(way_xy):
            d = _nearest_point_on_xy(x, y, main_xy)
            if best_d is None or d < best_d:
                best_d, best_i = d, i
        if best_i is None or best_d is None or best_d > SIDE_ROAD_JUNCTION_RADIUS_M:
            continue
        stub, junction_index = _trim_stub(way_xy, best_i, SIDE_ROAD_STUB_HALF_LEN_M)
        if len(stub) >= 2:
            out.append(SideRoad(points_xy=[[x, y] for x, y in stub], junction_index=junction_index))
        if len(out) >= SIDE_ROAD_MAX:
            break
    return out


def extract(raw: RawRoad) -> Tuple[RoadGeometry, RoadFeatures]:
    points = raw["points"]
    length_m = polyline_length_m(points)
    # Project against an explicit shared reference (the road's own centroid) rather
    # than each geometry set computing its own — building footprints below need to
    # land in the exact same local frame as the road polyline, not a nearby one.
    ref_lat = sum(p[0] for p in points) / len(points)
    ref_lon = sum(p[1] for p in points) / len(points)
    xy = project_ref(points, ref_lat, ref_lon)
    sharp_turns, max_curv, avg_change = curvature_stats(xy)

    tags = raw["tags"]
    road_class = tags.get("highway") or "unclassified"
    lanes = tags.get("lanes") or (1 if road_class in ("service", "living_street") else 2)

    estimated = []
    speed_limit = tags.get("maxspeed_kmh")
    if speed_limit is None:
        speed_limit = DEFAULT_SPEED_KMH.get(road_class, 40)
        estimated.append("speed_limit_kmh")

    volume = DEFAULT_VOLUME_VPH.get(road_class, 300)
    estimated.append("estimated_volume_vph")  # no live traffic counter source exists in this prototype

    # A missing `sidewalk` tag means "unknown" (OSRM-sourced roads carry NO
    # tags at all — see osrm_provider.py's _route_to_road — and even real OSM
    # ways often simply don't have this tag mapped), not "confirmed absent".
    # Silently treating unknown as False (as this used to) let has_lighting's
    # already-correct honest pattern be undermined by this field: risk_engine
    # was scoring "we don't know" as a hard fact at full CMF weight on every
    # single OSRM road (verified: 144/144 in this app's own scanned-road
    # sample).
    #
    # "unclassified" belongs in BOTH lists below (it didn't before, for
    # either field): per OSM's own tagging definition, highway=unclassified
    # means "a minor public road", ordinary in character, not "road class
    # unknown" — this codebase already treats it that way everywhere else
    # (Scenery.tsx's own urban-road regex includes it alongside residential/
    # tertiary). Every OSRM-sourced road defaults its highway tag to None ->
    # "unclassified" (osrm_provider.py never has a real tag to report), so
    # omitting it here meant "we don't have a class for this road" was
    # silently scored the same as "this is definitely too minor a road to
    # ever have lighting or a sidewalk" — verified: road_class was
    # "unclassified" for 144/144 real scanned roads in this app's own sample,
    # making that omission the dominant reason both fields read False
    # everywhere, not the road-type-specific weighting these estimates were
    # meant to express.
    PLAUSIBLE_SIDEWALK_CLASSES = ("residential", "living_street", "primary", "secondary", "tertiary", "unclassified")
    PLAUSIBLE_LIGHTING_CLASSES = ("primary", "secondary", "trunk", "motorway", "motorway_link", "unclassified")

    sidewalk_tag = tags.get("sidewalk")
    if sidewalk_tag is None:
        has_sidewalk = road_class in PLAUSIBLE_SIDEWALK_CLASSES
        estimated.append("has_sidewalk")
    else:
        has_sidewalk = sidewalk_tag not in ("no", "none")

    lit_tag = tags.get("lit")
    if lit_tag is None:
        has_lighting = road_class in PLAUSIBLE_LIGHTING_CLASSES
        estimated.append("has_lighting")
    else:
        has_lighting = bool(lit_tag)

    crossings = raw.get("nearby_crossings", [])
    crossing_density = (len(crossings) / (length_m / 1000)) if length_m > 0 else 0.0
    signal_count = len(raw.get("nearby_signals", []))
    guardrail_present = bool(raw.get("guardrail_present"))

    slope = raw.get("slope_pct")
    if slope is None:
        # "many sharp turns -> assume steep" is a reasonable proxy for the demo
        # catalog's switchbacks (authored so turns and elevation drop go together)
        # and for real OSM ways in mountain regions, but it's actively wrong for an
        # OSRM route: a winding real street/backwater-causeway road can have many
        # turns purely from following canal/property boundaries on totally flat
        # ground, and OSRM gives no elevation data to check that against. Applying
        # the same heuristic invented a fictional 30m+ elevation profile for flat
        # real roads, which then had the terrain rise up and occlude the road.
        slope = 1.5 if raw.get("source") == "osrm" else (8.0 if sharp_turns >= 4 else 1.5)
        estimated.append("slope_pct")

    near_water = bool(raw.get("water_nearby"))
    near_school_or_hospital = len(raw.get("nearby_schools", [])) > 0 or len(raw.get("nearby_hospitals", [])) > 0
    intersections = raw.get("intersections", 0) or 0
    intersection_density = (intersections / (length_m / 1000)) if length_m > 0 else 0.0

    footprints_xy = [
        [[x, y] for x, y in project_ref(ring, ref_lat, ref_lon)]
        for ring in raw.get("building_footprints", [])
    ]
    side_roads = _extract_side_roads(xy, raw.get("nearby_ways", []), ref_lat, ref_lon)
    accident_stats = accident_data.nearby_stats(points, length_m)

    geometry = RoadGeometry(
        points=[LatLng(lat=p[0], lon=p[1]) for p in points],
        local_xy=[[x, y] for x, y in xy],
        length_m=length_m,
        building_footprints_xy=footprints_xy,
        side_roads=side_roads,
    )
    features = RoadFeatures(
        length_m=length_m,
        sharp_turn_count=sharp_turns,
        max_curvature_deg_per_20m=max_curv,
        avg_heading_change_deg=avg_change,
        lanes=lanes,
        speed_limit_kmh=float(speed_limit),
        estimated_volume_vph=float(volume),
        road_class=road_class,
        has_sidewalk=has_sidewalk,
        has_lighting=has_lighting,
        crossing_density_per_km=crossing_density,
        signal_count=signal_count,
        guardrail_present=guardrail_present,
        slope_pct=float(slope),
        near_water=near_water,
        near_school_or_hospital=near_school_or_hospital,
        intersection_density_per_km=intersection_density,
        accident_data_available=accident_data.available(),
        accident_count=accident_stats.count,
        accident_per_km=accident_stats.accidents_per_km,
        accident_avg_severity=accident_stats.avg_severity,
        accident_night_pct=accident_stats.night_pct,
        accident_junction_pct=accident_stats.junction_pct,
        accident_crossing_pct=accident_stats.crossing_pct,
        accident_signal_pct=accident_stats.signal_pct,
        accident_adverse_weather_pct=accident_stats.adverse_weather_pct,
        estimated=estimated,
    )
    return geometry, features
