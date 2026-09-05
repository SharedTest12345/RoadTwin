"""Catalog of interventions and the (feature-space) transformation each one
applies. Interventions mutate RoadFeatures directly so the risk model and
simulator recompute from real inputs — no post-hoc score fudging."""
import copy
from dataclasses import dataclass
from typing import Callable, Dict, List, Tuple

from ..models.schemas import RoadFeatures, InterventionOption


@dataclass
class InterventionDef:
    id: str
    name: str
    category: str
    cost_estimate_inr: float
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


CATALOG: List[InterventionDef] = [
    InterventionDef("guardrail", "Install Guardrail", "Road safety", 150000, "low",
                     "Physical barrier along curves and drop-offs to prevent run-off-road crashes.",
                     _guardrail, twin_key="guardrail_active",
                     applicable_check=lambda f: (not f.guardrail_present, "Guardrail already present")),
    InterventionDef("speed_reduction", "Reduce Speed Environment", "Traffic", 25000, "low",
                     "Lower posted speed limit with traffic calming (signage, humps) to reduce speed environment by ~25%.",
                     _speed_reduction, speed_scale=0.75,
                     applicable_check=lambda f: (f.speed_limit_kmh > 25, "Speed already low")),
    InterventionDef("street_lighting", "Add Street Lighting", "Road safety", 90000, "medium",
                     "Install street lighting to improve nighttime visibility along the corridor.",
                     _lighting, twin_key="lighting_active",
                     applicable_check=lambda f: (not f.has_lighting, "Lighting already present")),
    InterventionDef("pedestrian_crossing", "Add Pedestrian Crossing", "Pedestrian", 60000, "low",
                     "Add marked/signalized pedestrian crossing(s) to reduce pedestrian exposure.",
                     _crossing, twin_key="crossing_active",
                     applicable_check=lambda f: (True, "")),
    InterventionDef("sidewalk", "Add Sidewalk", "Pedestrian", 220000, "high",
                     "Construct dedicated sidewalk to separate pedestrians from vehicle traffic.",
                     _sidewalk, twin_key="sidewalk_active",
                     applicable_check=lambda f: (not f.has_sidewalk, "Sidewalk already present")),
    InterventionDef("signal_control", "Improve Intersection Control", "Traffic", 120000, "medium",
                     "Add/retime a traffic signal to break up conflict-prone platoons at intersections.",
                     _signal, add_signal=True, twin_key="signal_active",
                     applicable_check=lambda f: (f.intersection_density_per_km > 1.0, "Low intersection density")),
    InterventionDef("road_markings", "Improve Road Markings", "Road safety", 18000, "low",
                     "Repaint lane/curve warning markings to improve driver perception of curvature ahead.",
                     _markings, twin_key="markings_active",
                     applicable_check=lambda f: (f.sharp_turn_count > 0 or f.max_curvature_deg_per_20m > 5,
                                                  "No significant curvature to mark")),
]

BY_ID: Dict[str, InterventionDef] = {d.id: d for d in CATALOG}


def get_catalog(features: RoadFeatures) -> List[InterventionOption]:
    out = []
    for d in CATALOG:
        applicable, reason = d.applicable_check(features)
        out.append(InterventionOption(
            id=d.id, name=d.name, category=d.category, cost_estimate_inr=d.cost_estimate_inr,
            complexity=d.complexity, description=d.description,
            applicable=applicable, applicable_reason=(reason or None),
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


def total_cost(ids: List[str]) -> float:
    return sum(BY_ID[i].cost_estimate_inr for i in ids if i in BY_ID)


def names_for(ids: List[str]) -> List[str]:
    return [BY_ID[i].name for i in ids if i in BY_ID]
