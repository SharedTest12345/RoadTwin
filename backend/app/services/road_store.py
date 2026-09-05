"""In-memory road cache + provider orchestration (live OSM with demo fallback).
This is the seam described in the spec as RoadDataProvider: callers never know
or care whether a Road came from Overpass or the curated demo catalog."""
import logging
from typing import Dict, List, Optional

from ..models.schemas import Road, RoadTags, NearbyContext, LatLng
from ..providers.base import RawRoad
from ..providers.demo_provider import DemoProvider
from ..providers.osm_provider import OSMProvider
from ..providers.osrm_provider import OSRMProvider
from . import feature_extraction, risk_engine

log = logging.getLogger("roadtwin.road_store")

_demo = DemoProvider()
_osm = OSMProvider()
_osrm = OSRMProvider()
_cache: Dict[str, Road] = {}


def _build_road(raw: RawRoad) -> Road:
    geometry, features = feature_extraction.extract(raw)
    risk = risk_engine.evaluate(features)
    pts = raw["points"]
    c = pts[len(pts) // 2]
    tags_raw = raw["tags"]
    road = Road(
        id=raw["osm_id"], name=raw["name"], source=raw["source"], region=raw["region"],
        center=LatLng(lat=c[0], lon=c[1]), geometry=geometry,
        tags=RoadTags(
            highway=tags_raw.get("highway") or "unclassified", name=raw["name"],
            lanes=tags_raw.get("lanes"), maxspeed_kmh=tags_raw.get("maxspeed_kmh"),
            oneway=bool(tags_raw.get("oneway")), surface=tags_raw.get("surface"),
            lit=tags_raw.get("lit"), sidewalk=tags_raw.get("sidewalk"), bridge=bool(tags_raw.get("bridge")),
        ),
        context=NearbyContext(
            signals_count=len(raw.get("nearby_signals", [])), crossings_count=len(raw.get("nearby_crossings", [])),
            schools_count=len(raw.get("nearby_schools", [])), hospitals_count=len(raw.get("nearby_hospitals", [])),
            water_nearby=bool(raw.get("water_nearby")), guardrail_present=bool(raw.get("guardrail_present")),
            intersections_count=raw.get("intersections", 0) or 0,
        ),
        features=features, risk=risk,
        guardrail_active=features.guardrail_present,
        cliff_scenario=(features.near_water and features.slope_pct > 8 and not features.guardrail_present)
                        or (features.slope_pct > 10 and not features.guardrail_present),
    )
    _cache[road.id] = road
    return road


def get_random_road(prefer_live: bool = True) -> Road:
    raw = None
    if prefer_live:
        try:
            raw = _osm.get_random_road()
        except Exception as exc:
            log.warning("live OSM random road failed: %s", exc)
        if not raw:
            # Overpass and OSRM are independent services (different operators,
            # different failure modes) — Overpass being down/rate-limited doesn't
            # mean the wider OSM ecosystem is unreachable, so this still returns a
            # real, road-network-following route before giving up to demo data.
            try:
                raw = _osrm.get_random_road()
            except Exception as exc:
                log.warning("live OSRM random road failed, falling back to demo: %s", exc)
    if not raw:
        raw = _demo.get_random_road()
    return _build_road(raw)


def get_road(road_id: str) -> Optional[Road]:
    if road_id in _cache:
        return _cache[road_id]
    raw = _demo.get_road(road_id)
    if not raw and road_id.startswith("osm:"):
        try:
            raw = _osm.get_road(road_id)
        except Exception as exc:
            log.warning("live OSM get_road failed: %s", exc)
    if not raw:
        return None
    return _build_road(raw)


def list_demo_roads() -> List[Road]:
    out = []
    for r in _demo.list_roads():
        out.append(_cache.get(r["osm_id"]) or _build_road(r))
    return out


def list_live_sample() -> List[Road]:
    raws: List[RawRoad] = []
    try:
        raws = _osm.list_roads()
    except Exception as exc:
        log.warning("live OSM list_roads failed: %s", exc)
    if not raws:
        try:
            raws = _osrm.list_roads()
        except Exception as exc:
            log.warning("live OSRM list_roads failed: %s", exc)
    return [_build_road(r) for r in raws]
