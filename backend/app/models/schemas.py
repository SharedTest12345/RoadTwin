"""Pydantic data contracts shared across the RoadTwin backend pipeline."""
from __future__ import annotations
from typing import List, Optional, Dict
from pydantic import BaseModel, Field


class LatLng(BaseModel):
    lat: float
    lon: float


class RoadGeometry(BaseModel):
    points: List[LatLng]
    local_xy: List[List[float]]  # projected meters, same length as points, [x, y]
    length_m: float
    building_footprints_xy: List[List[List[float]]] = Field(default_factory=list)
    # Real OSM building footprint polygons (each a ring of [x, y] meters), projected
    # into the SAME local frame as local_xy above. Empty for demo roads / roads with
    # no nearby OSM building data — the frontend falls back to procedural placement.


class RoadTags(BaseModel):
    highway: str = "unclassified"
    name: Optional[str] = None
    lanes: Optional[int] = None
    maxspeed_kmh: Optional[float] = None
    oneway: bool = False
    surface: Optional[str] = None
    lit: Optional[bool] = None
    sidewalk: Optional[str] = None  # "both" | "left" | "right" | "no" | None
    bridge: bool = False


class NearbyContext(BaseModel):
    signals_count: int = 0
    crossings_count: int = 0
    schools_count: int = 0
    hospitals_count: int = 0
    water_nearby: bool = False
    guardrail_present: bool = False
    intersections_count: int = 0


class RoadFeatures(BaseModel):
    length_m: float
    sharp_turn_count: int
    max_curvature_deg_per_20m: float
    avg_heading_change_deg: float
    lanes: int
    speed_limit_kmh: float
    estimated_volume_vph: float
    road_class: str
    has_sidewalk: bool
    has_lighting: bool
    crossing_density_per_km: float
    signal_count: int
    guardrail_present: bool
    slope_pct: float
    near_water: bool
    near_school_or_hospital: bool
    intersection_density_per_km: float
    estimated: List[str] = Field(default_factory=list)  # names of fields that are model-estimated, not source data


class RiskContribution(BaseModel):
    factor: str
    category: str
    points: float
    description: str


class RiskResult(BaseModel):
    score_0_100: float
    safety_score_0_100: float
    stars: float
    category: str
    contributions: List[RiskContribution]
    category_totals: Dict[str, float]
    summary: str


class Road(BaseModel):
    id: str
    name: str
    source: str  # "osm" | "osrm" | "demo"
    region: str
    center: LatLng
    geometry: RoadGeometry
    tags: RoadTags
    context: NearbyContext
    features: RoadFeatures
    risk: RiskResult
    guardrail_active: bool = False
    cliff_scenario: bool = False


class VehicleFrame(BaseModel):
    id: int
    x: float
    y: float
    heading_deg: float
    v_ms: float
    lane: int
    braking: bool = False


class SimFrame(BaseModel):
    t: float
    vehicles: List[VehicleFrame]


class ConflictEvent(BaseModel):
    t: float
    vehicle_a: int
    vehicle_b: int
    ttc_s: float
    x: float
    y: float


class SimMetrics(BaseModel):
    avg_speed_kmh: float
    avg_delay_s: float
    conflict_count: int
    max_density_veh_per_km: float
    vehicles_simulated: int


class SimResult(BaseModel):
    frames: List[SimFrame]
    conflicts: List[ConflictEvent]
    metrics: SimMetrics
    duration_s: float
    dt: float


class InterventionOption(BaseModel):
    id: str
    name: str
    category: str
    cost_estimate_inr: float
    complexity: str  # low | medium | high
    description: str
    applicable: bool = True
    applicable_reason: Optional[str] = None


class RoadAnalyzeRequest(BaseModel):
    road_id: str


class SimulationRunRequest(BaseModel):
    road_id: str
    duration_s: float = 30.0
    intervention_ids: List[str] = Field(default_factory=list)


class InterventionSimulateRequest(BaseModel):
    road_id: str
    intervention_ids: List[str]


class InterventionSimulateResult(BaseModel):
    road_id: str
    before_risk: RiskResult
    after_risk: RiskResult
    before_sim: SimMetrics
    after_sim: SimMetrics
    applied: List[InterventionOption]
    twin_changes: Dict[str, bool]


class OptimizeRequest(BaseModel):
    road_id: str
    objective: str = "balanced"  # safety | traffic | budget | balanced
    budget_cap: Optional[float] = None


class ComboEvaluation(BaseModel):
    intervention_ids: List[str]
    names: List[str]
    risk_after: float
    risk_reduction: float
    cost_estimate_inr: float
    est_delay_after_s: float
    est_conflict_reduction_pct: float
    objective_score: float


class OptimizeResult(BaseModel):
    road_id: str
    objective: str
    best: ComboEvaluation
    evaluated: List[ComboEvaluation]
    explanation: str


class PriorityMapEntry(BaseModel):
    road_id: str
    name: str
    region: str
    center: LatLng
    risk_score: float
    category: str
    priority_score: float
    traffic_exposure: float
    pedestrian_exposure: float
    estimated_cost_to_fix_inr: float


class PriorityMapResult(BaseModel):
    entries: List[PriorityMapEntry]
    counts_by_category: Dict[str, int]
    methodology: str
