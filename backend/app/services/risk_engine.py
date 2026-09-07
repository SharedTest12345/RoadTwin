"""Interpretable additive risk model. Every point on the 0-100 score traces to
a named, human-readable contribution — no black box. See README for the full
rationale of each rule."""
from typing import List

from ..models.schemas import RoadFeatures, RiskResult, RiskContribution
from ..providers.base import PEDESTRIAN_EXEMPT_CLASSES

CATEGORIES = ["geometry", "traffic", "infrastructure", "pedestrian", "visibility", "environmental", "historical"]

# Real correlation pass over the Kaggle US-Accidents dataset (7,728,394 US
# crashes, 2016-2023 — see backend/scripts/build_accident_grid.py and the raw
# output in backend/accident_correlations.json). IMPORTANT: the dataset's own
# `Severity` field (1-4) is documented by its author as impact on TRAFFIC
# (how long a delay the crash caused), not injury/fatality severity — this
# code and the UI say "traffic impact" for that reason, never "how dangerous",
# to avoid implying a medical claim the data doesn't support.
#
# Avg traffic-impact severity split by condition present at the crash site:
#   Traffic_Signal:  2.090 present  vs 2.234 absent  (n=1.14M / 6.58M)
#   Crossing:        2.064 present  vs 2.231 absent  (n=0.87M / 6.85M)
#   Stop sign:       2.076 present  vs 2.216 absent  (n=0.21M / 7.51M)
#   Junction:        2.298 present  vs 2.206 absent  (n=0.57M / 7.16M) — HIGHER,
#     not lower, when at a junction. Read together with the three rows above,
#     the pattern isn't "junctions are dangerous" but "a junction with a
#     signal/crossing/stop control sees a LESS traffic-impactful crash than an
#     uncontrolled one" — which is exactly what `uncontrolled_intersections`
#     already penalizes below. Kept that factor's existing flat 8-point weight
#     rather than inflating it from this alone: the effect is real but modest
#     (~5-7% relative), not dramatic.
#   Night:           2.219 vs 2.209 — Adverse weather: 2.235 vs 2.210. Both
#     essentially flat (<1% difference) on THIS metric. That does NOT mean
#     lighting/weather don't matter for safety — it means traffic-delay impact
#     specifically isn't where their effect shows up (a night crash on an
#     empty road backs up traffic just as briefly as a day one). This dataset
#     gives no basis to change `no_street_lighting`'s existing weight, so it
#     wasn't touched.
# Dataset-wide average (all 7.73M rows), used as the baseline below:
HISTORICAL_SEVERITY_BASELINE = 2.212


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
    # A guardrail protects against an unprotected DROP-OFF (embankment, cliff,
    # water edge) — a curve alone isn't that. Used to also trigger on bare
    # `sharp_turn_count > 0`, which any ordinary city-street bend satisfies
    # (curvature_stats flags any >25 deg heading change as a "sharp turn",
    # something a normal intersection corner does routinely) — that read as
    # "install a highway guardrail at this urban curb-lined curve," which no
    # real road engineer would ever do; a curb, not a guardrail, is what
    # separates an urban carriageway from its edge. Real slope/water data is
    # what actually indicates an edge worth protecting.
    hazardous_edge = f.near_water or f.slope_pct > 5
    if not f.guardrail_present and hazardous_edge:
        pts = 12 if (f.near_water or f.slope_pct > 8) else 7
        c.append(RiskContribution(factor="no_guardrail", category="infrastructure", points=pts,
                                   description="No guardrail on a curve/edge with drop-off exposure"))
    if f.intersection_density_per_km > 3 and f.signal_count == 0:
        c.append(RiskContribution(factor="uncontrolled_intersections", category="infrastructure", points=8,
                                   description="Frequent intersections with no signal control nearby"))

    # --- pedestrian ---
    # A motorway/trunk road is structurally off-limits to pedestrians — penalizing
    # it for lacking a sidewalk or crossings it was never meant to have would be
    # scoring a real risk factor against a road that can't have that risk.
    if f.road_class not in PEDESTRIAN_EXEMPT_CLASSES:
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

    # --- historical (real recorded crash data, Kaggle US-Accidents) ---
    if f.accident_data_available and f.accident_count > 0:
        # Density is the dominant, well-supported term: real recorded crashes
        # per km near this exact corridor is direct ground truth, not a proxy.
        # The traffic-impact term is deliberately capped small (max 3, vs.
        # density's 14) — the correlation analysis above found that metric
        # moves only ~5-7% across the conditions this app can actually act on,
        # so it's kept as a minor tiebreaker rather than a primary driver: a
        # corridor with a cluster of real crashes is risky regardless of how
        # much traffic delay each one happened to cause.
        density_pts = _clamp(f.accident_per_km * 2.2, 0, 14)
        impact_pts = _clamp((f.accident_avg_severity - HISTORICAL_SEVERITY_BASELINE) * 5, 0, 3)
        pts = _clamp(density_pts + impact_pts, 0, 17)
        if pts > 0:
            c.append(RiskContribution(
                factor="historical_crash_record", category="historical", points=pts,
                description=(
                    f"{f.accident_count} real recorded crash(es) within ~500m of this corridor since 2016 "
                    f"(~{f.accident_per_km:.1f}/km — US-Accidents dataset)"
                ),
            ))

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
