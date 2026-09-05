import { useEffect, lazy, Suspense } from "react";
import { useStore } from "./state/store";
import { TopBar } from "./components/TopBar";
import { BottomBar } from "./components/BottomBar";
import { RiskPanel } from "./components/panels/RiskPanel";
import { WhyPanel } from "./components/panels/WhyPanel";
import { InterventionPanel } from "./components/panels/InterventionPanel";
import { PriorityMapPanel } from "./components/panels/PriorityMapPanel";
import { Shuffle, Loader2 } from "lucide-react";

// Deferred: three.js/R3F (~270KB gzipped) isn't needed until a road is actually
// loaded, and recharts (~100KB gzipped) isn't needed until Before/After is opened —
// splitting them out keeps the welcome screen's first paint light.
const Scene3D = lazy(() => import("./components/scene3d/Scene").then((m) => ({ default: m.Scene3D })));
const BeforeAfterPanel = lazy(() => import("./components/panels/BeforeAfterPanel").then((m) => ({ default: m.BeforeAfterPanel })));

function WelcomeOverlay() {
  const scanRandomRoad = useStore((s) => s.scanRandomRoad);
  const scanning = useStore((s) => s.scanning);
  const scanError = useStore((s) => s.scanError);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
      <div className="pointer-events-auto flex flex-col items-center text-center max-w-lg px-6">
        <div className="mono text-[11px] tracking-[0.3em] text-accent mb-3">ROAD RISK INTELLIGENCE</div>
        <h1 className="text-3xl font-extrabold mb-3">Turn any road into a digital twin.</h1>
        <p className="text-sm text-base-400 mb-7 leading-relaxed">
          RoadTwin pulls real road geometry, builds a 3D twin, runs a traffic &amp; conflict simulation, and
          produces an explainable risk score — then lets you simulate infrastructure changes and see the impact.
        </p>
        <button
          onClick={scanRandomRoad}
          disabled={scanning}
          className="flex items-center gap-2 px-5 py-3 rounded-lg bg-accent text-base-950 font-bold text-sm hover:bg-accent/90 transition-colors disabled:opacity-60"
        >
          {scanning ? <Loader2 size={16} className="animate-spin" /> : <Shuffle size={16} />}
          Scan Random Road
        </button>
        {scanError && <div className="text-risk-high text-[12px] mt-3">{scanError}</div>}

        <div className="mono text-[10px] text-base-500 mt-10 flex items-center gap-1.5 flex-wrap justify-center">
          {["INPUT DATA", "FEATURE EXTRACTION", "RISK MODEL", "SIMULATION", "INTERVENTION", "NEW RESULT"].map((s, i, arr) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="px-2 py-1 border border-base-700 rounded">{s}</span>
              {i < arr.length - 1 && <span className="text-base-600">→</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SidePanel() {
  const road = useStore((s) => s.road);
  const panel = useStore((s) => s.panel);
  if (!road) return null;
  return (
    <div className="w-[380px] shrink-0 border-l border-base-700 bg-base-900 overflow-y-auto px-4 py-4">
      {panel === "risk" && <RiskPanel />}
      {panel === "why" && <WhyPanel />}
      {panel === "interventions" && <InterventionPanel />}
      {panel === "beforeafter" && (
        <Suspense fallback={<div className="text-[12.5px] text-base-400">Loading…</div>}>
          <BeforeAfterPanel />
        </Suspense>
      )}
    </div>
  );
}

export default function App() {
  const road = useStore((s) => s.road);
  const viewMode = useStore((s) => s.viewMode);
  const scanning = useStore((s) => s.scanning);
  const loadRoadById = useStore((s) => s.loadRoadById);
  const scanRandomRoad = useStore((s) => s.scanRandomRoad);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("autodemo")) return;
    const roadId = params.get("autodemo");
    if (roadId) loadRoadById(roadId);
    else scanRandomRoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-base-950 text-base-100">
      <TopBar />
      <div className="flex-1 flex relative overflow-hidden">
        <div className="flex-1 relative min-w-0">
          <Suspense fallback={<div className="absolute inset-0 bg-base-950" />}>
            <Scene3D />
          </Suspense>
          {!road && <WelcomeOverlay />}
          {scanning && road && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-base-900/90 border border-base-700 rounded-full px-4 py-1.5 text-[12px] mono">
              <Loader2 size={13} className="animate-spin text-accent" /> Scanning road…
            </div>
          )}
          {viewMode === "twin" && <BottomBar />}
        </div>
        <SidePanel />
        {viewMode === "priority" && <PriorityMapPanel />}
      </div>
    </div>
  );
}
