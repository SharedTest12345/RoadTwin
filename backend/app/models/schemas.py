"""Pydantic data contracts shared across the RoadTwin backend pipeline."""
from __future__ import annotations
from typing import List, Optional, Dict
from pydantic import BaseModel, Field


class LatLng(BaseModel):
    lat: float
    lon: float


class SideRoad(BaseModel):
    # A real OSM street that actually meets this road, trimmed to a short stub
    # centered on their real junction point — same local (x, y) meter frame as
    # RoadGeometry.local_xy. Visual only: the traffic simulation doesn't route
    # vehicles onto/from these (see feature_extraction.py's side-road extraction
    # for how the junction/trim is found).
    points_xy: List[List[float]]
    # Index into points_xy of the actual junction point — sent explicitly so
    # the frontend places its signal/stop-line there directly instead of
    # re-deriving "which point is the junction" with a second search.
    junction_index: int


class RoadGeometry(BaseModel):
    points: List[LatLng]
    local_xy: List[List[float]]  # projected meters, same length as points, [x, y]
    length_m: float
    building_footprints_xy: List[List[List[float]]] = Field(default_factory=list)
    # Real OSM building footprint polygons (each a ring of [x, y] meters), projected
    # into the SAME local frame as local_xy above. Empty for demo roads / roads with
    # no nearby OSM building data — the frontend falls back to procedural placement.
    side_roads: List[SideRoad] = Field(default_factory=list)


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
    # Real historical crash data (Kaggle US-Accidents, 2016-2023) near this
    # road's actual coordinates — see services/accident_data.py. Zeroed out
    # (accident_data_available=False) rather than guessed when the offline
    # grid build hasn't been run, same as every other optional live source.
    accident_data_available: bool = False
    accident_count: int = 0
    accident_per_km: float = 0.0
    # 1-4, Kaggle's own "Severity" scale — per the dataset's own documentation
    # this measures TRAFFIC IMPACT (how long a delay the crash caused), not
    # injury/fatality severity. Never label this "how dangerous" in the UI.
    accident_avg_severity: float = 0.0
    accident_night_pct: float = 0.0
    accident_junction_pct: float = 0.0
    accident_crossing_pct: float = 0.0
    accident_signal_pct: float = 0.0
    accident_adverse_weather_pct: float = 0.0
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


class RoadSummary(BaseModel):
    """Lightweight per-road record for the Home map: enough to draw the road and
    populate its preview card without shipping the full simulation-ready payload
    (RawRoad context, sim frames, etc.) that GET /roads/{road_id} returns."""
    id: str
    name: str
    source: str  # "osm" | "osrm" | "demo"
    region: str
    center: LatLng
    points: List[LatLng]
    length_m: float
    lanes: int
    speed_limit_kmh: float
    estimated_volume_vph: float
    risk_score: float
    safety_score: float
    stars: float
    category: str
    summary: str
    cliff_scenario: bool
    has_sidewalk: bool
    has_lighting: bool
    guardrail_present: bool


class VehicleFrame(BaseModel):
    # Arc-length position (+ signed lateral lane offset) along the road's own
    # path, not a raw x/y — the frontend resamples the same real points into a
    # smooth Catmull-Rom curve for rendering (Road.tsx/CameraRig/etc all read
    # off that curve), while this sim's `lookup()` walks the raw, sparser point
    # list as straight chords. Sending world x/y computed from the chord version
    # put vehicles visibly off the smooth rendered curve on any real bend — a
    # car would cut inside the chord while the road surface arced outward.
    # Sending `s` instead lets the frontend re-sample its OWN smooth curve at
    # the same arc length, so the vehicle always sits exactly on the curve it's
    # actually rendered against, on any road.
    id: int
    s: float
    lane_offset_m: float
    v_ms: float
    lane: int
    braking: bool = False


class PedestrianFrame(BaseModel):
    # Same arc-length-plus-lateral-offset convention as VehicleFrame, and for
    # the same reason: the frontend re-samples its own smooth curve at `s`
    # rather than trusting a straight-chord world position from this sim's
    # sparser raw point list.
    id: int
    s: float
    lateral_m: float  # signed offset from centerline; sidewalk when walking, sweeps across when crossing
    crossing: bool = False


class SimFrame(BaseModel):
    t: float
    vehicles: List[VehicleFrame]
    pedestrians: List[PedestrianFrame] = Field(default_factory=list)


class ConflictEvent(BaseModel):
    t: float
    vehicle_a: int
    vehicle_b: int
    ttc_s: float
    s: float


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
    # Fraction (0..1) along the route of the pedestrian crossing this sim
    # actually stops traffic at (None if there isn't one). The frontend
    # renders its own crossing/signal at this SAME fraction of ITS OWN curve
    # instead of independently re-searching for "the straight point nearest
    # the midpoint" over a different (denser, resampled) point set — two
    # separate searches over differently-sampled geometry can walk outward at
    # different physical step sizes and settle on two different straight
    # stretches of the same road, which is what put the rendered zebra
    # crossing at one spot while pedestrians (and the traffic light) treated
    # a completely different spot as "the crossing."
    crossing_frac: Optional[float] = None


class InterventionOption(BaseModel):
    id: str
    name: str
    category: str
    cost_estimate_usd: float
    complexity: str  # low | medium | high
    description: str
    applicable: bool = True
    applicable_reason: Optional[str] = None
    # Set only when this road's own nearby real crash history (not a generic
    # rule) specifically supports this intervention — see
    # intervention_engine.py's accident_evidence(). None for roads with no
    # accident-data coverage, or where the local pattern doesn't stand out.
    evidence: Optional[str] = None


class RoadAnalyzeRequest(BaseModel):
    road_id: str


class SimulationRunRequest(BaseModel):
    road_id: str
    duration_s: float = 300.0
    intervention_ids: List[str] = Field(default_factory=list)
    # Mirrors the frontend's "rain" weather preset — wet pavement means lower
    # grip, so the physics actually sheds speed and opens up following gaps
    # instead of the weather preset being a purely visual toggle.
    is_wet: bool = False


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
    cost_estimate_usd: float
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
    estimated_cost_to_fix_usd: float


class PriorityMapResult(BaseModel):
    entries: List[PriorityMapEntry]
    counts_by_category: Dict[str, int]
    methodology: str
