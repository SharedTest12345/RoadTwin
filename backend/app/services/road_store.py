"""Road cache + provider orchestration (live OSM with demo fallback). This is
the seam described in the spec as RoadDataProvider: callers never know or care
whether a Road came from Overpass or the curated demo catalog. Real (non-demo)
scans persist to road_db (SQLite) so the "roads RoadTwin has scanned" catalog
survives a backend restart; `_cache` remains a fast in-process lookup on top
of that for the current process's lifetime."""
import logging
import random
from typing import Dict, List, Optional

from ..models.schemas import Road, RoadTags, NearbyContext, LatLng
from ..providers.base import RawRoad
from ..providers.demo_provider import DemoProvider
from ..providers.osm_provider import OSMProvider
from ..providers.osrm_provider import OSRMProvider
from . import feature_extraction, risk_engine, road_db

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
    if road.source != "demo":
        # Persist every real (OSM/OSRM) scan — this is the actual "road
        # intelligence database" building up over time, not a fixed catalog.
        try:
            road_db.save_road(road)
        except Exception as exc:
            log.warning("failed to persist scanned road %s: %s", road.id, exc)
    return road


def _already_known(road_id: str) -> bool:
    return road_id in _cache or road_db.get_road(road_id) is not None


def _fetch_live_candidates() -> List[RawRoad]:
    """OSM (Overpass) first — the common case (it finds something genuinely
    new) stays a single network request, same cost as before. OSRM is only
    ALSO tried when OSM came back empty or landed on an already-known
    duplicate — that's the specific case the old code handled badly (it
    would just accept the duplicate rather than widening the search), not a
    reason to pay for a second request on every attempt regardless of
    whether OSM already succeeded. Overpass and OSRM are independent
    services (different operators, different failure modes) with their own
    separate candidate pools, so this second try has a real chance of
    finding something OSM's (possibly increasingly-saturated) region pool
    didn't have."""
    out: List[RawRoad] = []
    try:
        raw = _osm.get_random_road()
        if raw:
            out.append(raw)
    except Exception as exc:
        log.warning("live OSM random road failed: %s", exc)
    if not out or _already_known(out[0]["osm_id"]):
        try:
            raw = _osrm.get_random_road()
            if raw:
                out.append(raw)
        except Exception as exc:
            log.warning("live OSRM random road failed: %s", exc)
    return out


# Both curated pools (OSM's REGIONS, OSRM's waypoint pairs) are small and
# fixed, and shrink in practical terms every time this succeeds (that road is
# now "already known") — a "scan random road" click can easily re-land on one
# already sitting in the catalog. Each attempt re-shuffles/re-queries BOTH
# pools independently (see _fetch_live_candidates), so a handful of retries
# has a real chance of surfacing a still-unscanned one.
MAX_UNIQUE_ATTEMPTS = 4


def get_random_road(prefer_live: bool = True) -> Road:
    raw = None
    if prefer_live:
        for attempt in range(MAX_UNIQUE_ATTEMPTS):
            candidates = _fetch_live_candidates()
            if not candidates:
                break  # both live sources are down — no point retrying them
            fresh = [c for c in candidates if not _already_known(c["osm_id"])]
            if fresh:
                raw = random.choice(fresh)
                break
            # Keep the LAST round's candidate in hand only so there's still
            # something to fall back to if every attempt below also fails to
            # find anything new — never returned as-is while there's still a
            # chance of finding something genuinely unscanned.
            raw = candidates[0]
            log.info("scan attempt %d found only already-known roads, retrying", attempt + 1)
    if raw is None or _already_known(raw["osm_id"]):
        # Retries exhausted without finding anything genuinely new. Returning
        # that stale `raw` here would silently hand back a digital twin of a
        # road already in the database — not what "scan a NEW road" promised
        # — so fall back to demo data instead, which is always a real,
        # distinct road even though it isn't live OSM.
        demo = _demo.get_random_road()
        if demo:
            raw = demo
    return _build_road(raw)


def get_road(road_id: str) -> Optional[Road]:
    if road_id in _cache:
        return _cache[road_id]
    # A previously-scanned real road persists across backend restarts — check
    # the database before falling back to a fresh live fetch or demo data.
    persisted = road_db.get_road(road_id)
    if persisted:
        _cache[road_id] = persisted
        return persisted
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


def list_known_roads() -> List[Road]:
    """Roads RoadTwin has actually scanned — powers the Home map. Demo roads are
    deliberately excluded here: their geometry is an authored illustrative
    curve near a real coordinate (see demo_provider.py), not a live-traced
    street, so mixing them into a "roads we've scanned" map read as broken/
    mismatched against the real basemap. They're still individually reachable
    (GET /roads/{id}, the Demo button, ?autodemo=) for the flagship walkthrough
    — just not surfaced in this discovery catalog. Backed by road_db, so the
    list survives a backend restart instead of resetting to empty."""
    return road_db.list_roads()


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
