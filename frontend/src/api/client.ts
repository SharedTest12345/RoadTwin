import type {
  Road, RoadSummary, SimResult, InterventionOption, InterventionSimulateResult,
  OptimizeResult, PriorityMapResult, Objective,
} from "../types";

const BASE = "/api";

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text}`);
  }
  return res.json();
}

export const api = {
  health: () => req<{ status: string; live_osm_enabled: boolean }>("/health"),
  knownRoads: () => req<RoadSummary[]>("/roads"),
  randomRoad: (live = true) => req<Road>(`/roads/random?live=${live}`),
  getRoad: (id: string) => req<Road>(`/roads/${encodeURIComponent(id)}`),
  catalog: (roadId: string) => req<InterventionOption[]>(`/interventions/catalog/${encodeURIComponent(roadId)}`),
  runSimulation: (road_id: string, duration_s = 300, intervention_ids: string[] = [], is_wet = false) =>
    req<SimResult>("/simulation/run", { method: "POST", body: JSON.stringify({ road_id, duration_s, intervention_ids, is_wet }) }),
  simulateInterventions: (road_id: string, intervention_ids: string[]) =>
    req<InterventionSimulateResult>("/interventions/simulate", {
      method: "POST", body: JSON.stringify({ road_id, intervention_ids }),
    }),
  optimize: (road_id: string, objective: Objective, budget_cap?: number) =>
    req<OptimizeResult>("/interventions/optimize", {
      method: "POST", body: JSON.stringify({ road_id, objective, budget_cap: budget_cap ?? null }),
    }),
  priorityMap: (liveSample = false) => req<PriorityMapResult>(`/priority-map?live_sample=${liveSample}`),
};
