import { create } from "zustand";
import { api } from "../api/client";
import type {
  Road, SimResult, InterventionOption, InterventionSimulateResult,
  OptimizeResult, PriorityMapResult, Objective,
} from "../types";

export type Panel = "risk" | "why" | "interventions" | "beforeafter";
export type ViewMode = "twin" | "priority";

interface RoadTwinState {
  road: Road | null;
  scanning: boolean;
  scanError: string | null;
  flyTrigger: number;

  sim: SimResult | null;
  simLoading: boolean;
  simTime: number;
  simPlaying: boolean;

  catalog: InterventionOption[];
  stagedIds: string[];
  interventionResult: InterventionSimulateResult | null;
  applyingIntervention: boolean;
  twinOverrides: Record<string, boolean>;

  optimizeResult: OptimizeResult | null;
  optimizing: boolean;
  objective: Objective;

  priorityMap: PriorityMapResult | null;
  priorityLoading: boolean;

  panel: Panel;
  viewMode: ViewMode;

  scanRandomRoad: () => Promise<void>;
  loadRoadById: (id: string) => Promise<void>;
  toggleStaged: (id: string) => void;
  applyStaged: () => Promise<void>;
  resetInterventions: () => Promise<void>;
  runOptimize: (objective: Objective) => Promise<void>;
  applyOptimizerBest: () => Promise<void>;
  loadPriorityMap: () => Promise<void>;
  setPanel: (p: Panel) => void;
  setViewMode: (v: ViewMode) => void;
  tickSim: (dt: number) => void;
  setSimPlaying: (p: boolean) => void;
  scrubSim: (t: number) => void;
}

async function fetchBaselineSim(roadId: string, set: (partial: Partial<RoadTwinState>) => void) {
  set({ simLoading: true });
  try {
    const sim = await api.runSimulation(roadId, 30, []);
    set({ sim, simLoading: false, simTime: 0, simPlaying: true });
  } catch {
    set({ simLoading: false });
  }
}

export const useStore = create<RoadTwinState>((set, get) => ({
  road: null,
  scanning: false,
  scanError: null,
  flyTrigger: 0,

  sim: null,
  simLoading: false,
  simTime: 0,
  simPlaying: false,

  catalog: [],
  stagedIds: [],
  interventionResult: null,
  applyingIntervention: false,
  twinOverrides: {},

  optimizeResult: null,
  optimizing: false,
  objective: "balanced",

  priorityMap: null,
  priorityLoading: false,

  panel: "risk",
  viewMode: "twin",

  scanRandomRoad: async () => {
    if (get().scanning) return; // guards against StrictMode double-invoke / rapid double-clicks racing
    set({ scanning: true, scanError: null, sim: null, interventionResult: null, optimizeResult: null,
          stagedIds: [], twinOverrides: {}, panel: "risk" });
    try {
      const road = await api.randomRoad(true);
      const catalog = await api.catalog(road.id);
      set({ road, catalog, scanning: false, flyTrigger: get().flyTrigger + 1 });
      fetchBaselineSim(road.id, set);
    } catch (e) {
      set({ scanning: false, scanError: e instanceof Error ? e.message : "Failed to scan road" });
    }
  },

  loadRoadById: async (id: string) => {
    if (get().scanning) return;
    set({ scanning: true, scanError: null, sim: null, interventionResult: null, optimizeResult: null,
          stagedIds: [], twinOverrides: {}, panel: "risk", viewMode: "twin" });
    try {
      const road = await api.getRoad(id);
      const catalog = await api.catalog(road.id);
      set({ road, catalog, scanning: false, flyTrigger: get().flyTrigger + 1 });
      fetchBaselineSim(road.id, set);
    } catch (e) {
      set({ scanning: false, scanError: e instanceof Error ? e.message : "Failed to load road" });
    }
  },

  toggleStaged: (id: string) => {
    const staged = get().stagedIds;
    set({ stagedIds: staged.includes(id) ? staged.filter((s) => s !== id) : [...staged, id] });
  },

  applyStaged: async () => {
    const road = get().road;
    const staged = get().stagedIds;
    if (!road || staged.length === 0) return;
    set({ applyingIntervention: true });
    try {
      const result = await api.simulateInterventions(road.id, staged);
      set({ interventionResult: result, twinOverrides: result.twin_changes, applyingIntervention: false, panel: "beforeafter" });
      const sim = await api.runSimulation(road.id, 30, staged);
      set({ sim, simTime: 0, simPlaying: true });
    } catch {
      set({ applyingIntervention: false });
    }
  },

  resetInterventions: async () => {
    const road = get().road;
    set({ stagedIds: [], interventionResult: null, twinOverrides: {}, optimizeResult: null });
    if (road) fetchBaselineSim(road.id, set);
  },

  runOptimize: async (objective: Objective) => {
    const road = get().road;
    if (!road) return;
    set({ optimizing: true, objective });
    try {
      const result = await api.optimize(road.id, objective);
      set({ optimizeResult: result, optimizing: false });
    } catch {
      set({ optimizing: false });
    }
  },

  applyOptimizerBest: async () => {
    const result = get().optimizeResult;
    if (!result) return;
    set({ stagedIds: result.best.intervention_ids });
    await get().applyStaged();
  },

  loadPriorityMap: async () => {
    set({ priorityLoading: true });
    try {
      const priorityMap = await api.priorityMap(false);
      set({ priorityMap, priorityLoading: false });
    } catch {
      set({ priorityLoading: false });
    }
  },

  setPanel: (p) => set({ panel: p }),
  setViewMode: (v) => set({ viewMode: v }),

  tickSim: (dt: number) => {
    const { sim, simPlaying, simTime } = get();
    if (!sim || !simPlaying || sim.frames.length === 0) return;
    const maxT = sim.frames[sim.frames.length - 1].t;
    let next = simTime + dt;
    if (next > maxT) next = 0;
    set({ simTime: next });
  },
  setSimPlaying: (p: boolean) => set({ simPlaying: p }),
  scrubSim: (t: number) => set({ simTime: t }),
}));
