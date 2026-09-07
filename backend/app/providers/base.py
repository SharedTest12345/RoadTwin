"""RoadDataProvider abstraction. Every provider returns the same raw shape so
feature extraction/risk/sim code never needs to know where the road came from."""
from abc import ABC, abstractmethod
from typing import List, Optional, TypedDict, Tuple


class RawNode(TypedDict, total=False):
    lat: float
    lon: float
    tags: dict


class RawRoad(TypedDict):
    osm_id: str
    name: str
    region: str
    points: List[Tuple[float, float]]  # (lat, lon) in way order
    tags: dict
    nearby_signals: List[Tuple[float, float]]
    nearby_crossings: List[Tuple[float, float]]
    nearby_schools: List[Tuple[float, float]]
    nearby_hospitals: List[Tuple[float, float]]
    water_nearby: bool
    guardrail_present: bool
    intersections: int
    slope_pct: Optional[float]
    source: str
    building_footprints: List[List[Tuple[float, float]]]  # real OSM building polygons (lat, lon) rings nearby
    nearby_ways: List[List[Tuple[float, float]]]  # other real OSM highway ways (lat, lon) near the route —
    # candidates for the side/incoming roads feature_extraction.py trims to stubs at their real junction point


# Default speed/volume lookup by OSM highway classification. These are transparent
# fallback assumptions, used only when the source data doesn't supply a value.
DEFAULT_SPEED_KMH = {
    "motorway": 100, "trunk": 90, "primary": 70, "secondary": 55,
    "tertiary": 45, "unclassified": 35, "residential": 30, "service": 20,
    "living_street": 15, "motorway_link": 60, "trunk_link": 50,
}
DEFAULT_VOLUME_VPH = {
    "motorway": 1800, "trunk": 1400, "primary": 1000, "secondary": 700,
    "tertiary": 450, "unclassified": 300, "residential": 180, "service": 90,
    "living_street": 60, "motorway_link": 900, "trunk_link": 700,
}


class RoadDataProvider(ABC):
    name: str = "base"

    @abstractmethod
    def get_random_road(self) -> Optional[RawRoad]:
        ...

    @abstractmethod
    def get_road(self, road_id: str) -> Optional[RawRoad]:
        ...

    @abstractmethod
    def list_roads(self) -> List[RawRoad]:
        ...
