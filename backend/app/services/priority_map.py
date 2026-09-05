"""Government/priority mode: ranks a set of roads by an estimated
intervention-priority score. Prototype methodology, explicitly labeled as such
per the spec's data-honesty requirement."""
from typing import List

from ..models.schemas import PriorityMapEntry, PriorityMapResult, Road
from . import road_store, intervention_engine as ie
from .risk_engine import CATEGORY_THRESHOLDS

METHODOLOGY = (
    "Prototype prioritization methodology: priority = risk_score x traffic_exposure x "
    "pedestrian_exposure / cost_factor, where traffic_exposure and pedestrian_exposure are "
    "derived from estimated volume, school/hospital proximity and sidewalk presence, and "
    "cost_factor is a rule-based estimate of the interventions this road would need. This is "
    "a prototype prioritization heuristic, not an official engineering or budgetary assessment."
)


# Title-cased view of the SAME thresholds risk_engine._category_label uses — this
# used to be an independently-declared 4-way if/else that quietly drifted out of
# sync with the per-road category labels (a "MODERATE CONCERN" road vs. a
# "Moderate" bucket, etc.). Deriving it from CATEGORY_THRESHOLDS makes drift
# impossible: change the tiers in one place and both views move together.
_BUCKET_BY_CATEGORY = {label: label.title() for _, label in CATEGORY_THRESHOLDS}


def _bucket(category: str) -> str:
    return _BUCKET_BY_CATEGORY.get(category, "Low")


def _estimate_fix_cost(road: Road) -> float:
    f = road.features
    ids = []
    if not f.guardrail_present and (f.sharp_turn_count > 0 or f.near_water or f.slope_pct > 5):
        ids.append("guardrail")
    if f.speed_limit_kmh > 55:
        ids.append("speed_reduction")
    if not f.has_lighting:
        ids.append("street_lighting")
    if not f.has_sidewalk and f.near_school_or_hospital:
        ids.append("sidewalk")
    if f.near_school_or_hospital and f.crossing_density_per_km < 1.5:
        ids.append("pedestrian_crossing")
    if f.intersection_density_per_km > 3 and f.signal_count == 0:
        ids.append("signal_control")
    return max(ie.total_cost(ids), 15000.0)


def _entry(road: Road) -> PriorityMapEntry:
    # Risk is the primary driver; exposure/cost are kept as moderate multipliers
    # (roughly 0.7-1.4x) so a CRITICAL road always outranks a LOW one, per the
    # spec's intent that this is a risk-led prioritization, not a pure volume ranking.
    f = road.features
    traffic_exposure = 0.7 + min(f.estimated_volume_vph, 2000.0) / 2000.0 * 0.7
    pedestrian_exposure = 0.85 + (0.35 if f.near_school_or_hospital else 0.0) + (0.2 if not f.has_sidewalk else 0.0)
    cost = _estimate_fix_cost(road)
    cost_factor = max(0.8, min(1.6, 0.8 + cost / 300000.0 * 0.6))
    priority = road.risk.score_0_100 * traffic_exposure * pedestrian_exposure / cost_factor
    return PriorityMapEntry(
        road_id=road.id, name=road.name, region=road.region, center=road.center,
        risk_score=road.risk.score_0_100, category=_bucket(road.risk.category),
        priority_score=round(priority, 1), traffic_exposure=round(traffic_exposure, 2),
        pedestrian_exposure=round(pedestrian_exposure, 2), estimated_cost_to_fix_inr=cost,
    )


def build(include_live_sample: bool = True) -> PriorityMapResult:
    roads: List[Road] = road_store.list_demo_roads()
    if include_live_sample:
        roads += road_store.list_live_sample()

    seen = set()
    entries = []
    for r in roads:
        if r.id in seen:
            continue
        seen.add(r.id)
        entries.append(_entry(r))

    entries.sort(key=lambda e: -e.priority_score)
    counts = {"Critical": 0, "High": 0, "Moderate": 0, "Low": 0}
    for e in entries:
        counts[e.category] += 1

    return PriorityMapResult(entries=entries, counts_by_category=counts, methodology=METHODOLOGY)
