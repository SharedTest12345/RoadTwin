"""Turns a RawRoad (from any provider) into typed geometry + features.
Every value that is not directly sourced from OSM/provider tags is tracked
in `estimated` so the UI can label it honestly."""
from typing import Tuple

from ..models.schemas import RoadGeometry, RoadFeatures, LatLng
from ..providers.base import RawRoad, DEFAULT_SPEED_KMH, DEFAULT_VOLUME_VPH
from .geometry import polyline_length_m, project_ref, curvature_stats


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

    has_sidewalk = (tags.get("sidewalk") or "no") not in ("no", "none", None)

    lit_tag = tags.get("lit")
    if lit_tag is None:
        has_lighting = road_class in ("primary", "secondary", "trunk", "motorway", "motorway_link")
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

    geometry = RoadGeometry(
        points=[LatLng(lat=p[0], lon=p[1]) for p in points],
        local_xy=[[x, y] for x, y in xy],
        length_m=length_m,
        building_footprints_xy=footprints_xy,
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
        estimated=estimated,
    )
    return geometry, features
