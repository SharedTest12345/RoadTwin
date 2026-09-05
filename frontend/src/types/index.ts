export interface LatLng {
  lat: number;
  lon: number;
}

export interface RoadGeometry {
  points: LatLng[];
  local_xy: [number, number][];
  length_m: number;
  building_footprints_xy: [number, number][][];
}

export interface RoadTags {
  highway: string;
  name?: string;
  lanes?: number;
  maxspeed_kmh?: number;
  oneway: boolean;
  surface?: string;
  lit?: boolean;
  sidewalk?: string;
  bridge: boolean;
}

export interface NearbyContext {
  signals_count: number;
  crossings_count: number;
  schools_count: number;
  hospitals_count: number;
  water_nearby: boolean;
  guardrail_present: boolean;
  intersections_count: number;
}

export interface RoadFeatures {
  length_m: number;
  sharp_turn_count: number;
  max_curvature_deg_per_20m: number;
  avg_heading_change_deg: number;
  lanes: number;
  speed_limit_kmh: number;
  estimated_volume_vph: number;
  road_class: string;
  has_sidewalk: boolean;
  has_lighting: boolean;
  crossing_density_per_km: number;
  signal_count: number;
  guardrail_present: boolean;
  slope_pct: number;
  near_water: boolean;
  near_school_or_hospital: boolean;
  intersection_density_per_km: number;
  estimated: string[];
}

export interface RiskContribution {
  factor: string;
  category: string;
  points: number;
  description: string;
}

export interface RiskResult {
  score_0_100: number;
  safety_score_0_100: number;
  stars: number;
  category: string;
  contributions: RiskContribution[];
  category_totals: Record<string, number>;
  summary: string;
}

export interface Road {
  id: string;
  name: string;
  source: "osm" | "osrm" | "demo";
  region: string;
  center: LatLng;
  geometry: RoadGeometry;
  tags: RoadTags;
  context: NearbyContext;
  features: RoadFeatures;
  risk: RiskResult;
  guardrail_active: boolean;
  cliff_scenario: boolean;
}

export interface VehicleFrame {
  id: number;
  x: number;
  y: number;
  heading_deg: number;
  v_ms: number;
  lane: number;
  braking: boolean;
}

export interface SimFrame {
  t: number;
  vehicles: VehicleFrame[];
}

export interface ConflictEvent {
  t: number;
  vehicle_a: number;
  vehicle_b: number;
  ttc_s: number;
  x: number;
  y: number;
}

export interface SimMetrics {
  avg_speed_kmh: number;
  avg_delay_s: number;
  conflict_count: number;
  max_density_veh_per_km: number;
  vehicles_simulated: number;
}

export interface SimResult {
  frames: SimFrame[];
  conflicts: ConflictEvent[];
  metrics: SimMetrics;
  duration_s: number;
  dt: number;
}

export interface InterventionOption {
  id: string;
  name: string;
  category: string;
  cost_estimate_inr: number;
  complexity: "low" | "medium" | "high";
  description: string;
  applicable: boolean;
  applicable_reason?: string | null;
}

export interface InterventionSimulateResult {
  road_id: string;
  before_risk: RiskResult;
  after_risk: RiskResult;
  before_sim: SimMetrics;
  after_sim: SimMetrics;
  applied: InterventionOption[];
  twin_changes: Record<string, boolean>;
}

export interface ComboEvaluation {
  intervention_ids: string[];
  names: string[];
  risk_after: number;
  risk_reduction: number;
  cost_estimate_inr: number;
  est_delay_after_s: number;
  est_conflict_reduction_pct: number;
  objective_score: number;
}

export interface OptimizeResult {
  road_id: string;
  objective: string;
  best: ComboEvaluation;
  evaluated: ComboEvaluation[];
  explanation: string;
}

export interface PriorityMapEntry {
  road_id: string;
  name: string;
  region: string;
  center: LatLng;
  risk_score: number;
  category: "Critical" | "High" | "Moderate" | "Low";
  priority_score: number;
  traffic_exposure: number;
  pedestrian_exposure: number;
  estimated_cost_to_fix_inr: number;
}

export interface PriorityMapResult {
  entries: PriorityMapEntry[];
  counts_by_category: Record<string, number>;
  methodology: string;
}

export type Objective = "safety" | "traffic" | "budget" | "balanced";
