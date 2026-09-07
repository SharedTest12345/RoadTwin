"""Catalog of interventions and the (feature-space) transformation each one
applies. Interventions mutate RoadFeatures directly so the risk model and
simulator recompute from real inputs — no post-hoc score fudging."""
import copy
from dataclasses import dataclass
from typing import Callable, Dict, List, Tuple

from ..models.schemas import RoadFeatures, InterventionOption
from ..providers.base import PEDESTRIAN_EXEMPT_CLASSES, MOTORWAY_CLASSES
from . import accident_data


@dataclass
class InterventionDef:
    id: str
    name: str
    category: str
    cost_estimate_usd: float
    complexity: str
    description: str
    apply_fn: Callable[[RoadFeatures], None]
    speed_scale: float = 1.0
    add_signal: bool = False
    twin_key: str = ""
    applicable_check: Callable[[RoadFeatures], Tuple[bool, str]] = lambda f: (True, "")


def _guardrail(f: RoadFeatures):
    f.guardrail_present = True


def _speed_reduction(f: RoadFeatures):
    f.speed_limit_kmh = round(f.speed_limit_kmh * 0.75, 1)


def _lighting(f: RoadFeatures):
    f.has_lighting = True


def _crossing(f: RoadFeatures):
    f.crossing_density_per_km = round(f.crossing_density_per_km + 2.5, 2)


def _sidewalk(f: RoadFeatures):
    f.has_sidewalk = True


def _signal(f: RoadFeatures):
    f.signal_count += 1
    f.intersection_density_per_km = max(0.0, f.intersection_density_per_km - 1.0)


def _markings(f: RoadFeatures):
    f.max_curvature_deg_per_20m = round(f.max_curvature_deg_per_20m * 0.7, 2)
    f.avg_heading_change_deg = round(f.avg_heading_change_deg * 0.85, 2)


# Every applicable_check below is written to match the EXACT trigger condition
# risk_engine.py uses for the factor this intervention neutralizes — not a
# loosely-related proxy. Offering an intervention whose trigger doesn't match
# reality (e.g. guardrail on a flat straight road with no curve/water/slope
# edge, which risk_engine never penalizes for lack of guardrail in the first
# place) is a real, misleading gap: the fix wouldn't move the road's score at
# all, but the old code offered it anyway. Keeping these two files' conditions
# in lockstep is deliberate, not incidental — see get_catalog()'s filtering
# below for how a road ends up with a genuinely different menu than another.
CATALOG: List[InterventionDef] = [
    InterventionDef("guardrail", "Install Guardrail", "Road safety", 65000, "low",
                     "Physical barrier along curves and drop-offs to prevent run-off-road crashes.",
                     _guardrail, twin_key="guardrail_active",
                     # Mirrors risk_engine's `hazardous_edge` exactly (real edge/slope/
                     # water hazard, NOT bare curvature — see that file's comment: a
                     # guardrail belongs at an unprotected drop-off, not any ordinary
                     # city-street curve, which a curb already handles).
                     applicable_check=lambda f: (
                         not f.guardrail_present and (f.near_water or f.slope_pct > 5),
                         "Guardrail already present" if f.guardrail_present else
                         "No hazardous water edge or slope nearby for a guardrail to protect")),
    InterventionDef("speed_reduction", "Reduce Speed Environment", "Traffic", 8000, "low",
                     "Lower posted speed limit with traffic calming (signage, humps) to reduce speed environment by ~25%.",
                     _speed_reduction, speed_scale=0.75, twin_key="speed_bumps_active",
                     # Deliberately NOT gated on risk_engine's >50km/h high_vehicle_speed
                     # threshold — this also directly scales traffic_sim's target speed
                     # (real conflict/delay reduction), so it's worth offering any time
                     # there's meaningfully room to lower the limit, not only when the
                     # static score currently penalizes it.
                     applicable_check=lambda f: (f.speed_limit_kmh > 25, "Speed already low")),
    InterventionDef("street_lighting", "Add Street Lighting", "Road safety", 45000, "medium",
                     "Install street lighting to improve nighttime visibility along the corridor.",
                     _lighting, twin_key="lighting_active",
                     applicable_check=lambda f: (not f.has_lighting, "Lighting already present")),
    InterventionDef("pedestrian_crossing", "Add Pedestrian Crossing", "Pedestrian", 25000, "low",
                     "Add marked/signalized pedestrian crossing(s) to reduce pedestrian exposure.",
                     _crossing, twin_key="crossing_active",
                     # Mirrors risk_engine's `insufficient_crossings` trigger exactly —
                     # used to be unconditionally True, offering this even on roads with
                     # no school/hospital pedestrian exposure to actually address, or ones
                     # (motorway/trunk) that structurally carry no pedestrians at all.
                     applicable_check=lambda f: (
                         f.road_class not in PEDESTRIAN_EXEMPT_CLASSES
                         and f.near_school_or_hospital and f.crossing_density_per_km < 1.5,
                         "Road class carries no pedestrians" if f.road_class in PEDESTRIAN_EXEMPT_CLASSES
                         else "No nearby school/hospital pedestrian exposure to address")),
    InterventionDef("sidewalk", "Add Sidewalk", "Pedestrian", 180000, "high",
                     "Construct dedicated sidewalk to separate pedestrians from vehicle traffic.",
                     _sidewalk, twin_key="sidewalk_active",
                     # Mirrors risk_engine's own PEDESTRIAN_EXEMPT_CLASSES guard on
                     # no_sidewalk — a motorway/trunk road was never getting a sidewalk
                     # in the first place, so offering one (or scoring the lack of one)
                     # doesn't reflect anything real.
                     applicable_check=lambda f: (
                         f.road_class not in PEDESTRIAN_EXEMPT_CLASSES and not f.has_sidewalk,
                         "Road class carries no pedestrians" if f.road_class in PEDESTRIAN_EXEMPT_CLASSES
                         else "Sidewalk already present")),
    InterventionDef("signal_control", "Improve Intersection Control", "Traffic", 150000, "medium",
                     "Add/retime a traffic signal to break up conflict-prone platoons at intersections.",
                     _signal, add_signal=True, twin_key="signal_active",
                     # Was gated at >1.0 — risk_engine's own `uncontrolled_intersections`
                     # only triggers past >3, so this used to offer a signal on roads the
                     # risk model wasn't actually penalizing for intersection control.
                     applicable_check=lambda f: (
                         f.intersection_density_per_km > 3 and f.signal_count == 0,
                         "Already signal-controlled" if f.signal_count > 0 else "Low intersection density nearby")),
    InterventionDef("road_markings", "Improve Road Markings", "Road safety", 6000, "low",
                     "Repaint lane/curve warning markings to improve driver perception of curvature ahead.",
                     _markings, twin_key="markings_active",
                     # Was gated at sharp_turn_count>0 OR curvature>5 — sharp_turn_count
                     # isn't even mutated by this intervention (only curvature/heading-
                     # change are), and risk_engine's `tight_curve_radius` only triggers
                     # past >8, so the old >5 half of this let it show on curves too mild
                     # for the factor it's supposed to address.
                     applicable_check=lambda f: (f.max_curvature_deg_per_20m > 8, "No significant curvature to mark")),
]

BY_ID: Dict[str, InterventionDef] = {d.id: d for d in CATALOG}

# Real 2024/2025 US unit-cost ranges (contractor/municipal bid-price data for
# guardrail/streetlight/sidewalk/striping; FHWA HSIP project summaries and
# RRFB industry pricing for crossings) — using each range's midpoint as one
# representative rate, same "explainable estimate, not a fabricated number"
# posture risk_engine.py already uses for its point weights. A flat per-road
# total regardless of the road's actual length priced a 150m residential
# street identically to a 2.5km corridor for anything genuinely built by the
# linear foot — those five now scale with the road's real geometry.length_m
# (or crossing count / pole count derived from it) instead. signal_control
# ($150k-250k for a new intersection signal) and speed_reduction (signage +
# a couple of humps) stay flat: a signal serves one intersection regardless
# of corridor length, and neither is continuous linear construction.
M_TO_FT = 3.28084

GUARDRAIL_COST_PER_FT = 38.0          # $30-45/lf W-beam, installed
GUARDRAIL_END_TERMINAL_COST = 4500.0  # $2,500-6,500 each, two ends per run
GUARDRAIL_MIN_COST = 8000.0           # mobilization floor for a short run

STREETLIGHT_COST_PER_POLE = 5300.0    # $3,000-7,600 per pole, fully installed
STREETLIGHT_SPACING_M = 48.0          # matches Infrastructure.tsx's LAMP_SPACING_M

SIDEWALK_COST_PER_FT = 60.0           # $25-75/lf, one side, ADA-compliant concrete
SIDEWALK_MIN_COST = 10000.0           # concrete-contractor mobilization floor

CROSSING_COST_EACH = 12500.0          # RRFB/signalized crossing, $10k-15k
CROSSINGS_ADDED_PER_KM = 2.5          # matches _crossing()'s own density bump

MARKINGS_COST_PER_FT = 0.70           # thermoplastic re-striping, ~$0.62-0.74/lf
MARKINGS_MIN_COST = 1500.0            # crew mobilization floor


def _cost_estimate(intervention_id: str, f: RoadFeatures) -> float:
    """Per-road real-dollar estimate for the length/count-scaled interventions;
    falls back to the flat CATALOG constant (signal_control, speed_reduction,
    and any future id) unchanged."""
    length_ft = f.length_m * M_TO_FT
    if intervention_id == "guardrail":
        cost = length_ft * GUARDRAIL_COST_PER_FT + 2 * GUARDRAIL_END_TERMINAL_COST
        return round(max(cost, GUARDRAIL_MIN_COST) / 500) * 500
    if intervention_id == "street_lighting":
        poles = max(1, round(f.length_m / STREETLIGHT_SPACING_M))
        return round(poles * STREETLIGHT_COST_PER_POLE / 500) * 500
    if intervention_id == "sidewalk":
        cost = length_ft * SIDEWALK_COST_PER_FT
        return round(max(cost, SIDEWALK_MIN_COST) / 500) * 500
    if intervention_id == "pedestrian_crossing":
        crossings = max(1.0, CROSSINGS_ADDED_PER_KM * (f.length_m / 1000))
        return round(crossings * CROSSING_COST_EACH / 500) * 500
    if intervention_id == "road_markings":
        cost = length_ft * MARKINGS_COST_PER_FT
        return round(max(cost, MARKINGS_MIN_COST) / 500) * 500
    d = BY_ID.get(intervention_id)
    return d.cost_estimate_usd if d else 0.0

# Real-crash-pattern thresholds: an intervention only gets tagged with evidence
# when this road's own nearby crash mix is MEANINGFULLY above the national
# baseline for that condition (accident_data.NATIONAL_*_PCT — computed from
# the same 7.73M-row correlation pass risk_engine.py cites), not just present
# at all. "+15 points over the national share" is a deliberately blunt, easy-
# to-explain margin — this is a prototype heuristic for which factor to call
# out first, not a statistical significance test.
EVIDENCE_MARGIN_PTS = 15.0
MIN_EVIDENCE_COUNT = 5  # don't draw a pattern conclusion from a handful of crashes


def accident_evidence(features: RoadFeatures) -> Dict[str, str]:
    """Maps intervention id -> a real-data sentence, ONLY for interventions
    whose target condition shows up in THIS road's own nearby crash history
    meaningfully more than the national norm. Empty dict (never guessed) if
    there's no accident-data coverage or too few nearby crashes to say
    anything about a pattern.

    Evidence can override a WEAK PROXY condition an applicable_check uses
    (e.g. "not near a tagged school/hospital" as a stand-in for "pedestrians
    are exposed here") — real recorded outcomes outrank a guess. It must
    NEVER override a HARD FACT (guardrail_present, has_lighting, has_sidewalk,
    signal_count>0, speed already at the floor): you can't newly recommend
    installing something that's already there no matter what the crash
    history near it looks like. Every branch below re-checks the same hard
    fact its applicable_check already gates on before adding evidence."""
    f = features
    out: Dict[str, str] = {}
    if not f.accident_data_available or f.accident_count < MIN_EVIDENCE_COUNT:
        return out

    if not f.has_lighting and f.accident_night_pct >= accident_data.NATIONAL_NIGHT_PCT + EVIDENCE_MARGIN_PTS:
        out["street_lighting"] = (
            f"{f.accident_night_pct:.0f}% of the {f.accident_count} recorded crashes near this road "
            f"happened at night, vs. a {accident_data.NATIONAL_NIGHT_PCT:.0f}% national average."
        )
    # A true motorway never gets an at-grade signal (grade-separated by
    # definition) — same reasoning as the pedestrian guard below.
    if f.signal_count == 0 and f.road_class not in MOTORWAY_CLASSES and \
            f.accident_junction_pct >= accident_data.NATIONAL_JUNCTION_PCT + EVIDENCE_MARGIN_PTS:
        out["signal_control"] = (
            f"{f.accident_junction_pct:.0f}% of nearby recorded crashes occurred at a junction, vs. a "
            f"{accident_data.NATIONAL_JUNCTION_PCT:.0f}% national average."
        )
    # Limited-access roads structurally don't carry pedestrians — the ~500m
    # search buffer can still pick up a nearby city-street crossing cluster
    # (e.g. a highway_merge interchange sitting close to surface streets), and
    # without this guard that read as "this trunk highway needs a sidewalk,"
    # which is nonsensical regardless of what the buffer found nearby. Same
    # PEDESTRIAN_EXEMPT_CLASSES risk_engine.py and this file's own sidewalk/
    # pedestrian_crossing applicable_checks use — one road-class list, not three.
    pedestrian_relevant = f.road_class not in PEDESTRIAN_EXEMPT_CLASSES
    if pedestrian_relevant and f.accident_crossing_pct >= accident_data.NATIONAL_CROSSING_PCT + EVIDENCE_MARGIN_PTS:
        crossing_note = (
            f"{f.accident_crossing_pct:.0f}% of nearby recorded crashes occurred at a crossing, vs. a "
            f"{accident_data.NATIONAL_CROSSING_PCT:.0f}% national average."
        )
        out["pedestrian_crossing"] = crossing_note
        if not f.has_sidewalk:
            out["sidewalk"] = crossing_note
    # Real crash density alone supports speed_reduction on ANY road — traffic
    # calming helps a dense city intersection exactly as much as a rural one.
    # guardrail is different: it's a PHYSICAL fact whether there's an edge to
    # protect (embankment/cliff/water), not a soft proxy density evidence can
    # reasonably override — no crash count justifies bolting a highway
    # barrier onto a flat, curb-lined city intersection. Unlike the crossing/
    # sidewalk override above (near_school_or_hospital is genuinely just a
    # weak proxy for pedestrian exposure), water/slope IS the real thing
    # itself, so guardrail evidence still requires it, same as the base
    # applicable_check.
    if f.accident_per_km >= 5.0:
        density_note = (
            f"{f.accident_count} recorded crashes within ~500m of this corridor since 2016 "
            f"(~{f.accident_per_km:.1f}/km)."
        )
        if not f.guardrail_present and (f.near_water or f.slope_pct > 5):
            out.setdefault("guardrail", density_note)
        if f.speed_limit_kmh > 25:
            out.setdefault("speed_reduction", density_note)
    return out


def get_catalog(features: RoadFeatures) -> List[InterventionOption]:
    """Returns ONLY the interventions that would actually do something for
    THIS road — every applicable_check above mirrors an exact risk_engine
    trigger, so two roads with different real risk factors get genuinely
    different menus, not the same fixed 7 items with some merely disabled.
    Real accident-history evidence can additionally unlock an intervention
    the static OSM-tag proxy alone wouldn't have offered (e.g. a road whose
    nearby crash record skews heavily toward crossings, even if it isn't
    tagged near a school/hospital) — real recorded outcomes outrank a proxy
    when they disagree."""
    evidence = accident_evidence(features)
    out = []
    for d in CATALOG:
        base_applicable, reason = d.applicable_check(features)
        ev = evidence.get(d.id)
        applicable = base_applicable or ev is not None
        if not applicable:
            continue
        out.append(InterventionOption(
            id=d.id, name=d.name, category=d.category, cost_estimate_usd=_cost_estimate(d.id, features),
            complexity=d.complexity, description=d.description,
            applicable=True, applicable_reason=None, evidence=ev,
        ))
    return out


def apply_interventions(features: RoadFeatures, ids: List[str]) -> Tuple[RoadFeatures, dict, dict]:
    """Returns (new_features, sim_overrides, twin_changes)."""
    f = copy.deepcopy(features)
    sim_overrides = {"speed_scale": 1.0, "add_signal": False}
    twin_changes = {}
    for iid in ids:
        d = BY_ID.get(iid)
        if not d:
            continue
        d.apply_fn(f)
        sim_overrides["speed_scale"] *= d.speed_scale
        sim_overrides["add_signal"] = sim_overrides["add_signal"] or d.add_signal
        if d.twin_key:
            twin_changes[d.twin_key] = True
    return f, sim_overrides, twin_changes


def total_cost(ids: List[str], features: RoadFeatures) -> float:
    return sum(_cost_estimate(i, features) for i in ids if i in BY_ID)


def names_for(ids: List[str]) -> List[str]:
    return [BY_ID[i].name for i in ids if i in BY_ID]
