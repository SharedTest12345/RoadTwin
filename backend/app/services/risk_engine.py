"""Interpretable additive risk model. Every point on the 0-100 score traces to
a named, human-readable contribution — no black box. See README for the full
rationale of each rule."""
from typing import List

from ..models.schemas import RoadFeatures, RiskResult, RiskContribution

CATEGORIES = ["geometry", "traffic", "infrastructure", "pedestrian", "visibility", "environmental"]


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def compute_contributions(f: RoadFeatures) -> List[RiskContribution]:
    c: List[RiskContribution] = []

    # --- geometry ---
    if f.sharp_turn_count > 0:
        pts = _clamp(4 * f.sharp_turn_count, 0, 16)
        c.append(RiskContribution(factor="sharp_curvature", category="geometry", points=pts,
                                   description=f"Sharp curvature ({f.sharp_turn_count} sharp turn(s) detected)"))
    if f.max_curvature_deg_per_20m > 8:
        pts = _clamp((f.max_curvature_deg_per_20m - 8) * 1.1, 0, 10)
        c.append(RiskContribution(factor="tight_curve_radius", category="geometry", points=pts,
                                   description="Tight curve radius relative to road class"))
    if f.lanes <= 1:
        c.append(RiskContribution(factor="narrow_carriageway", category="geometry", points=5,
                                   description="Narrow carriageway (single effective lane)"))

    # --- traffic ---
    if f.speed_limit_kmh > 50:
        pts = _clamp((f.speed_limit_kmh - 50) * 0.3, 0, 14)
        c.append(RiskContribution(factor="high_vehicle_speed", category="traffic", points=pts,
                                   description=f"High posted/estimated speed (~{f.speed_limit_kmh:.0f} km/h)"))
    if f.estimated_volume_vph > 150:
        pts = _clamp(f.estimated_volume_vph / 160, 0, 12)
        c.append(RiskContribution(factor="high_traffic_volume", category="traffic", points=pts,
                                   description=f"High estimated vehicle volume (~{f.estimated_volume_vph:.0f} veh/h)"))

    # --- infrastructure ---
    hazardous_edge = f.sharp_turn_count > 0 or f.near_water or f.slope_pct > 5
    if not f.guardrail_present and hazardous_edge:
        pts = 12 if (f.near_water or f.slope_pct > 8) else 7
        c.append(RiskContribution(factor="no_guardrail", category="infrastructure", points=pts,
                                   description="No guardrail on a curve/edge with drop-off exposure"))
    if f.intersection_density_per_km > 3 and f.signal_count == 0:
        c.append(RiskContribution(factor="uncontrolled_intersections", category="infrastructure", points=8,
                                   description="Frequent intersections with no signal control nearby"))

    # --- pedestrian ---
    if not f.has_sidewalk:
        pts = 10 if f.near_school_or_hospital else 4
        c.append(RiskContribution(factor="no_sidewalk", category="pedestrian", points=pts,
                                   description="No dedicated sidewalk" + (" near school/hospital" if f.near_school_or_hospital else "")))
    if f.near_school_or_hospital and f.crossing_density_per_km < 1.5:
        c.append(RiskContribution(factor="insufficient_crossings", category="pedestrian", points=6,
                                   description="Insufficient pedestrian crossings near school/hospital"))

    # --- visibility ---
    if not f.has_lighting:
        c.append(RiskContribution(factor="no_street_lighting", category="visibility", points=5,
                                   description="No street lighting (estimated nighttime visibility risk)"))
        if f.sharp_turn_count > 0:
            c.append(RiskContribution(factor="unlit_blind_curves", category="visibility", points=4,
                                       description="Blind curves compounded by absence of lighting"))

    # --- environmental ---
    if f.slope_pct > 6:
        pts = _clamp((f.slope_pct - 6) * 1.0, 0, 8)
        c.append(RiskContribution(factor="steep_grade", category="environmental", points=pts,
                                   description=f"Steep grade (~{f.slope_pct:.1f}%)"))
    if f.near_water and not f.guardrail_present:
        c.append(RiskContribution(factor="unprotected_water_edge", category="environmental", points=10,
                                   description="Unprotected edge near water/steep drop-off"))
    if f.slope_pct > 10 and not f.guardrail_present:
        c.append(RiskContribution(factor="unprotected_dropoff", category="environmental", points=12,
                                   description="Steep drop-off without guardrail protection"))

    return c


CATEGORY_THRESHOLDS = (
    # (min_score, label) — this is the ONE place risk tiers are defined. Every other
    # spot in the app (priority map buckets, frontend colors, star bands) must derive
    # from this table rather than re-declaring its own thresholds, which is exactly
    # how the header/badge/star inconsistencies crept in before.
    (80, "CRITICAL"),
    (60, "HIGH"),
    (40, "MODERATE"),
    (0, "LOW"),
)


def _category_label(score: float) -> str:
    for threshold, label in CATEGORY_THRESHOLDS:
        if score >= threshold:
            return label
    return "LOW"


def evaluate(f: RoadFeatures) -> RiskResult:
    contributions = compute_contributions(f)
    total = sum(c.points for c in contributions)
    score = _clamp(total, 0, 100)
    safety_score = 100 - score
    stars = round(safety_score / 20, 1)

    totals = {cat: 0.0 for cat in CATEGORIES}
    for c in contributions:
        totals[c.category] += c.points

    contributions_sorted = sorted(contributions, key=lambda c: -c.points)
    if len(contributions_sorted) >= 2:
        top = contributions_sorted[:2]
        summary = (f"The largest contributors to this road's risk estimate are "
                   f"{top[0].description.lower()} and {top[1].description.lower()}.")
    elif contributions_sorted:
        summary = f"The main contributor to this road's risk estimate is {contributions_sorted[0].description.lower()}."
    else:
        summary = "No significant risk factors were detected in the available data."

    return RiskResult(
        score_0_100=round(score, 1),
        safety_score_0_100=round(safety_score, 1),
        stars=stars,
        category=_category_label(score),
        contributions=contributions_sorted,
        category_totals={k: round(v, 1) for k, v in totals.items()},
        summary=summary,
    )
