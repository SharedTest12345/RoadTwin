"""Deterministic, realistic-looking demo road dataset. Used whenever live OSM
data is unavailable, or explicitly requested. Geometry is authored as local
offsets (meters) around a real-world anchor coordinate, then projected back to
lat/lon so it renders sensibly on a map and in the 3D twin."""
import math
import random
from typing import List, Optional, Tuple

from .base import RoadDataProvider, RawRoad


def _local_to_latlon(anchor_lat: float, anchor_lon: float, xy: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    lat0_rad = math.radians(anchor_lat)
    mx = 111320.0 * math.cos(lat0_rad)
    my = 110540.0
    return [(anchor_lat + y / my, anchor_lon + x / mx) for x, y in xy]


def _road(rid, name, region, anchor, xy_path, tags, schools=0, hospitals=0, water=False,
          guardrail=False, signals=0, crossings=0, intersections=1, slope=1.5) -> RawRoad:
    lat0, lon0 = anchor
    points = _local_to_latlon(lat0, lon0, xy_path)
    rng = random.Random(rid)
    schools_pts = [(lat0 + rng.uniform(-0.0015, 0.0015), lon0 + rng.uniform(-0.0015, 0.0015)) for _ in range(schools)]
    hospitals_pts = [(lat0 + rng.uniform(-0.002, 0.002), lon0 + rng.uniform(-0.002, 0.002)) for _ in range(hospitals)]
    return RawRoad(
        osm_id=rid, name=name, region=region, points=points, tags=tags,
        nearby_signals=[points[min(i, len(points) - 1)] for i in range(signals)],
        nearby_crossings=[points[min(i * 3, len(points) - 1)] for i in range(crossings)],
        nearby_schools=schools_pts, nearby_hospitals=hospitals_pts,
        water_nearby=water, guardrail_present=guardrail, intersections=intersections,
        slope_pct=slope, source="demo", building_footprints=[],  # demo roads have no real OSM footprints
        nearby_ways=[],  # nor real neighboring streets to derive side-road stubs from
    )


def _switchback(n=14, span=550, amplitude=140, drop=60):
    pts = []
    for i in range(n):
        t = i / (n - 1)
        x = t * span
        y = amplitude * math.sin(t * math.pi * 2.4) - t * drop
        pts.append((x, y))
    return pts


def _gentle_curve(n=10, span=420, amplitude=35):
    pts = []
    for i in range(n):
        t = i / (n - 1)
        x = t * span
        y = amplitude * math.sin(t * math.pi * 1.1)
        pts.append((x, y))
    return pts


def _straight_with_kink(n=8, span=500, kink=90):
    pts = []
    for i in range(n):
        t = i / (n - 1)
        x = t * span
        y = kink * max(0.0, math.sin((t - 0.45) * math.pi)) if t > 0.45 else 0.0
        pts.append((x, y))
    return pts


def _urban_grid_leg(n=9, span=380):
    return [(t * span / (n - 1), 6 * math.sin(t * math.pi * 4)) for t in range(n)]


_DEMO_ROADS = {}


def _build_catalog():
    _DEMO_ROADS["pch_cliff_road"] = _road(
        "pch_cliff_road", "Pacific Coast Highway, Big Sur", "California, USA",
        (36.2704, -121.8081), _switchback(16, 620, 150, 70),
        tags=dict(highway="tertiary", lanes=2, maxspeed_kmh=50, oneway=False,
                  surface="asphalt", lit=False, sidewalk="no", bridge=False),
        water=True, guardrail=False, signals=0, crossings=0, intersections=1, slope=11.5,
    )
    _DEMO_ROADS["busy_intersection"] = _road(
        "busy_intersection", "Michigan Ave & Wacker Dr", "Chicago, Illinois, USA",
        (41.8875, -87.6243), _straight_with_kink(9, 480, 20),
        tags=dict(highway="primary", lanes=4, maxspeed_kmh=60, oneway=False,
                  surface="asphalt", lit=True, sidewalk="both", bridge=False),
        water=False, guardrail=False, signals=2, crossings=2, intersections=5, slope=0.5,
    )
    _DEMO_ROADS["school_corridor"] = _road(
        "school_corridor", "Lincoln Elementary School Corridor", "Denver, Colorado, USA",
        (39.7392, -104.9903), _gentle_curve(10, 400, 15),
        tags=dict(highway="residential", lanes=2, maxspeed_kmh=40, oneway=False,
                  surface="asphalt", lit=False, sidewalk="no", bridge=False),
        schools=2, water=False, guardrail=False, signals=0, crossings=1, intersections=3, slope=0.8,
    )
    _DEMO_ROADS["highway_merge"] = _road(
        "highway_merge", "I-70 Mountain Merge", "Golden, Colorado, USA",
        (39.7391, -105.2270), _gentle_curve(11, 700, 60),
        tags=dict(highway="trunk", lanes=3, maxspeed_kmh=100, oneway=True,
                  surface="asphalt", lit=True, sidewalk="no", bridge=False),
        water=False, guardrail=True, signals=0, crossings=0, intersections=1, slope=1.2,
    )
    _DEMO_ROADS["riverside_village_road"] = _road(
        "riverside_village_road", "Bayou Riverside Road", "Louisiana, USA",
        (29.9511, -90.0715), _switchback(12, 480, 60, 5),
        tags=dict(highway="unclassified", lanes=2, maxspeed_kmh=45, oneway=False,
                  surface="gravel", lit=False, sidewalk="no", bridge=False),
        water=True, guardrail=False, signals=0, crossings=0, intersections=2, slope=2.0,
    )
    _DEMO_ROADS["urban_congestion_street"] = _road(
        "urban_congestion_street", "Market Street Congestion", "San Francisco, California, USA",
        (37.7879, -122.4074), _urban_grid_leg(9, 380),
        tags=dict(highway="secondary", lanes=3, maxspeed_kmh=45, oneway=False,
                  surface="asphalt", lit=True, sidewalk="left", bridge=False),
        hospitals=1, water=False, guardrail=False, signals=3, crossings=3, intersections=6, slope=0.3,
    )
    _DEMO_ROADS["pedestrian_market_road"] = _road(
        "pedestrian_market_road", "Pike Place Market Road", "Seattle, Washington, USA",
        (47.6097, -122.3421), _urban_grid_leg(8, 300),
        tags=dict(highway="residential", lanes=2, maxspeed_kmh=30, oneway=False,
                  surface="asphalt", lit=True, sidewalk="no", bridge=False),
        schools=1, hospitals=1, water=False, guardrail=False, signals=1, crossings=0, intersections=4, slope=0.2,
    )


_build_catalog()


class DemoProvider(RoadDataProvider):
    name = "demo"

    def get_random_road(self) -> Optional[RawRoad]:
        return random.choice(list(_DEMO_ROADS.values()))

    def get_road(self, road_id: str) -> Optional[RawRoad]:
        return _DEMO_ROADS.get(road_id)

    def list_roads(self) -> List[RawRoad]:
        return list(_DEMO_ROADS.values())
