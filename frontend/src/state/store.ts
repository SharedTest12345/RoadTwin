import { create } from "zustand";
import { api } from "../api/client";
import type {
  Road, RoadSummary, SimResult, InterventionOption, InterventionSimulateResult,
  OptimizeResult, PriorityMapResult, Objective,
} from "../types";

export type TwinPanel = "risk" | "intel" | "interventions" | "compare";
export type WeatherPreset = "clear_day" | "night" | "rain" | "fog";
export type CameraPreset = "overview" | "driver_pov" | "cctv" | "hazard_inspect" | "free_fly";

// The stages a scan actually goes through end to end: a real network round
// trip (provider discovery + Overpass/OSRM fetch), then the real backend
// pipeline main.py already runs synchronously (feature_extraction -> risk_engine
// -> Road assembly). Index 1 is a hold point — the UI never claims to be past
// "acquiring geometry" until the network response has actually landed, so a
// slow Overpass round trip is honestly reflected as time spent right there.
export const SCAN_STAGES = [
  "Locating road",
  "Acquiring OSM/OSRM geometry",
  "Extracting road characteristics",
  "Analyzing infrastructure",
  "Estimating risk",
  "Generating digital twin",
] as const;
const SCAN_NETWORK_HOLD_INDEX = 1;

// Once the real response has landed, the remaining stages (feature
// extraction, risk evaluation, twin assembly) are already-computed facts —
// main.py ran them synchronously in the same request. This briefly paces
// revealing them so they're readable rather than an instant jump-cut, without
// pretending any further computation is still happening.
function flushScanStages(set: (partial: Partial<RoadTwinState>) => void) {
  return new Promise<void>((resolve) => {
    let i = SCAN_NETWORK_HOLD_INDEX + 1;
    const step = () => {
      if (i >= SCAN_STAGES.length) return resolve();
      set({ scanStage: i });
      i += 1;
      setTimeout(step, 200);
    };
    step();
  });
}

interface RoadTwinState {
  road: Road | null;
  scanning: boolean;
  scanStage: number | null;
  scanError: string | null;
  flyTrigger: number;

  sim: SimResult | null;
  simLoading: boolean;
  simTime: number;
  simPlaying: boolean;
  simSpeed: number;

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

  knownRoads: RoadSummary[] | null;
  knownRoadsLoading: boolean;
  knownRoadsError: string | null;

  panel: TwinPanel;
  weatherPreset: WeatherPreset;
  cameraPreset: CameraPreset;
  cameraPresetTrigger: number;
  reportOpen: boolean;
  audioMuted: boolean;

  scanRandomRoad: () => Promise<Road | null>;
  scanNewRoad: () => Promise<Road | null>;
  loadRoadById: (id: string) => Promise<Road | null>;
  loadKnownRoads: () => Promise<void>;
  toggleStaged: (id: string) => void;
  applyStaged: () => Promise<void>;
  resetInterventions: () => Promise<void>;
  runOptimize: (objective: Objective) => Promise<void>;
  applyOptimizerBest: () => Promise<void>;
  loadPriorityMap: () => Promise<void>;
  setPanel: (p: TwinPanel) => void;
  setWeatherPreset: (w: WeatherPreset) => void;
  setCameraPreset: (c: CameraPreset) => void;
  toggleAudioMuted: () => void;
  setReportOpen: (open: boolean) => void;
  tickSim: (dt: number) => void;
  setSimPlaying: (p: boolean) => void;
  setSimSpeed: (v: number) => void;
  scrubSim: (t: number) => void;
}

async function fetchBaselineSim(roadId: string, set: (partial: Partial<RoadTwinState>) => void, isWet = false) {
  set({ simLoading: true });
  try {
    const sim = await api.runSimulation(roadId, 300, [], isWet);
    set({ sim, simLoading: false, simTime: 0, simPlaying: true });
  } catch {
    set({ simLoading: false });
  }
}

export const useStore = create<RoadTwinState>((set, get) => ({
  road: null,
  scanning: false,
  scanStage: null,
  scanError: null,
  flyTrigger: 0,

  sim: null,
  simLoading: false,
  simTime: 0,
  simPlaying: false,
  simSpeed: 1,

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

  knownRoads: null,
  knownRoadsLoading: false,
  knownRoadsError: null,

  panel: "risk",
  weatherPreset: "clear_day",
  cameraPreset: "overview",
  cameraPresetTrigger: 0,
  reportOpen: false,
  audioMuted: false,

  scanRandomRoad: async () => {
    if (get().scanning) return null; // guards against StrictMode double-invoke / rapid double-clicks racing
    set({ scanning: true, scanStage: 0, scanError: null, sim: null, interventionResult: null, optimizeResult: null,
          stagedIds: [], twinOverrides: {}, panel: "risk", weatherPreset: "clear_day", cameraPreset: "overview" });
    // Advance up to the network-hold stage while the request is in flight —
    // never claims a later stage (e.g. "estimating risk") until that data has
    // actually come back from the backend.
    const holdTimer = setInterval(() => {
      set((s) => ({ scanStage: Math.min((s.scanStage ?? 0) + 1, SCAN_NETWORK_HOLD_INDEX) }));
    }, 300);
    try {
      const road = await api.randomRoad(true);
      clearInterval(holdTimer);
      await flushScanStages(set);
      const catalog = await api.catalog(road.id);
      set({ road, catalog, scanning: false, scanStage: null, flyTrigger: get().flyTrigger + 1 });
      fetchBaselineSim(road.id, set);
      return road;
    } catch (e) {
      clearInterval(holdTimer);
      set({ scanning: false, scanStage: null, scanError: e instanceof Error ? e.message : "Failed to scan road" });
      return null;
    }
  },

  // Scans a real new road WITHOUT jumping into its digital twin — used by the
  // Atlas-first "Scan New Road" entry points (TopNav, AtlasPage), which land
  // the user back on the map with the new road marked like any other scanned
  // road, exactly the same as clicking an existing one, rather than dropping
  // them straight into the 3D view. `scanRandomRoad` above stays as-is for the
  // in-twin flows that still want the immediate scan-and-view choreography
  // (the /twin/new route's error-retry path, the flagship demo).
  scanNewRoad: async () => {
    if (get().scanning) return null;
    set({ scanning: true, scanError: null });
    try {
      const road = await api.randomRoad(true);
      await get().loadKnownRoads();
      set({ scanning: false });
      return road;
    } catch (e) {
      set({ scanning: false, scanError: e instanceof Error ? e.message : "Failed to scan road" });
      return null;
    }
  },

  loadRoadById: async (id: string) => {
    if (get().scanning) return null;
    set({ scanning: true, scanStage: 0, scanError: null, sim: null, interventionResult: null, optimizeResult: null,
          stagedIds: [], twinOverrides: {}, panel: "risk", weatherPreset: "clear_day", cameraPreset: "overview" });
    const holdTimer = setInterval(() => {
      set((s) => ({ scanStage: Math.min((s.scanStage ?? 0) + 1, SCAN_NETWORK_HOLD_INDEX) }));
    }, 300);
    try {
      const road = await api.getRoad(id);
      clearInterval(holdTimer);
      await flushScanStages(set);
      const catalog = await api.catalog(road.id);
      set({ road, catalog, scanning: false, scanStage: null, flyTrigger: get().flyTrigger + 1 });
      fetchBaselineSim(road.id, set);
      return road;
    } catch (e) {
      clearInterval(holdTimer);
      set({ scanning: false, scanStage: null, scanError: e instanceof Error ? e.message : "Failed to load road" });
      return null;
    }
  },

  loadKnownRoads: async () => {
    set({ knownRoadsLoading: true, knownRoadsError: null });
    try {
      const knownRoads = await api.knownRoads();
      set({ knownRoads, knownRoadsLoading: false });
    } catch (e) {
      set({ knownRoadsLoading: false, knownRoadsError: e instanceof Error ? e.message : "Failed to load scanned roads" });
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
      set({ interventionResult: result, twinOverrides: result.twin_changes, applyingIntervention: false, panel: "compare" });
      const sim = await api.runSimulation(road.id, 300, staged, get().weatherPreset === "rain");
      set({ sim, simTime: 0, simPlaying: true });
    } catch {
      set({ applyingIntervention: false });
    }
  },

  resetInterventions: async () => {
    const road = get().road;
    set({ stagedIds: [], interventionResult: null, twinOverrides: {}, optimizeResult: null });
    if (road) fetchBaselineSim(road.id, set, get().weatherPreset === "rain");
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
  setWeatherPreset: (w) => {
    const wasWet = get().weatherPreset === "rain";
    const willBeWet = w === "rain";
    set({ weatherPreset: w });
    // Wet pavement actually changes the physics (traffic_sim.py's is_wet) —
    // re-run the sim so speeds/gaps reflect it instead of the weather preset
    // being a purely visual toggle. Only when wetness itself flips (not
    // every preset change — night/fog/clear_day are all "dry"). Re-runs with
    // whatever interventions are CURRENTLY applied (stagedIds), not always
    // the bare baseline — otherwise toggling weather while an intervention
    // is active would silently drop it from the sim while the UI still
    // showed it as applied.
    if (wasWet !== willBeWet) {
      const road = get().road;
      const staged = get().stagedIds;
      if (road) {
        set({ simLoading: true });
        api.runSimulation(road.id, 300, staged, willBeWet)
          .then((sim) => set({ sim, simLoading: false, simTime: 0, simPlaying: true }))
          .catch(() => set({ simLoading: false }));
      }
    }
  },
  setCameraPreset: (c) => set((s) => ({ cameraPreset: c, cameraPresetTrigger: s.cameraPresetTrigger + 1 })),
  setReportOpen: (open) => set({ reportOpen: open }),
  toggleAudioMuted: () => set((s) => ({ audioMuted: !s.audioMuted })),

  tickSim: (dt: number) => {
    const { sim, simPlaying, simTime, simSpeed } = get();
    if (!sim || !simPlaying || sim.frames.length === 0) return;
    const maxT = sim.frames[sim.frames.length - 1].t;
    let next = simTime + dt * simSpeed;
    if (next > maxT) next = 0;
    set({ simTime: next });
  },
  setSimPlaying: (p: boolean) => set({ simPlaying: p }),
  setSimSpeed: (v: number) => set({ simSpeed: v }),
  scrubSim: (t: number) => set({ simTime: t }),
}));
