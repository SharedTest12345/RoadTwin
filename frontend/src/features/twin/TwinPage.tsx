import { lazy, Suspense, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useStore } from "../../state/store";
import { ScanOverlay } from "./ScanOverlay";
import { PlaybackDock } from "./PlaybackDock";
import { TwinHeader } from "./TwinHeader";
import { AtmosphereDock } from "./AtmosphereDock";
import { ReportModal } from "./ReportModal";
import { RiskPanel } from "./panels/RiskPanel";
import { IntelPanel } from "./panels/IntelPanel";
import { InterventionPanel } from "./panels/InterventionPanel";

// Deferred: three.js/R3F (~270KB gzipped) isn't needed until a road is
// actually being viewed, and recharts (~100KB gzipped) isn't needed until
// Before/After is opened — splitting both out keeps the initial twin-page
// paint light instead of shipping every panel's dependencies up front.
const TwinScene = lazy(() => import("./scene/Scene").then((m) => ({ default: m.TwinScene })));
const ComparePanel = lazy(() => import("./panels/ComparePanel").then((m) => ({ default: m.ComparePanel })));

const PANEL_COMPONENTS = { risk: RiskPanel, intel: IntelPanel, interventions: InterventionPanel, compare: ComparePanel };

export function TwinPage() {
  const { roadId } = useParams<{ roadId: string }>();
  const navigate = useNavigate();
  const road = useStore((s) => s.road);
  const scanning = useStore((s) => s.scanning);
  const scanStage = useStore((s) => s.scanStage);
  const scanError = useStore((s) => s.scanError);
  const panel = useStore((s) => s.panel);
  const loadRoadById = useStore((s) => s.loadRoadById);
  const scanRandomRoad = useStore((s) => s.scanRandomRoad);

  // Tracks the id this effect has already kicked off a fetch for, so a
  // re-render (e.g. `road` updating after the fetch resolves) doesn't
  // re-trigger the same request — only an actual roadId param change does.
  const requestedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!roadId || requestedFor.current === roadId) return;
    requestedFor.current = roadId;
    if (roadId === "new") {
      scanRandomRoad().then((r) => {
        if (r) navigate(`/twin/${encodeURIComponent(r.id)}`, { replace: true });
      });
    } else {
      loadRoadById(roadId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roadId]);

  const PanelComponent = PANEL_COMPONENTS[panel];

  return (
    <div className="flex-1 flex relative overflow-hidden">
      <div className="flex-1 relative min-w-0 bg-ink-950">
        <Suspense fallback={<div className="absolute inset-0 bg-ink-950" />}>
          {road && <TwinScene />}
        </Suspense>

        {scanning && <ScanOverlay stage={scanStage ?? 0} />}

        {!scanning && scanError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="surface-elevated p-6 max-w-sm text-center">
              <AlertTriangle className="mx-auto mb-3 text-risk-high" size={28} />
              <p className="text-sm text-ink-200 mb-4">{scanError}</p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => navigate("/twin/new")}
                  className="px-3 py-1.5 rounded-md bg-brand text-ink-950 font-semibold text-sm hover:bg-brand-bright transition-colors"
                >
                  Try another road
                </button>
                <button
                  onClick={() => navigate("/")}
                  className="px-3 py-1.5 rounded-md border border-ink-600 hover:bg-ink-800 text-sm transition-colors"
                >
                  Back to Atlas
                </button>
              </div>
            </div>
          </div>
        )}

        {!scanning && !scanError && !road && (
          <div className="absolute inset-0 flex items-center justify-center text-ink-400 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Preparing digital twin&hellip;
          </div>
        )}

        {road && <TwinHeader road={road} />}
        {road && <AtmosphereDock />}
        {road && <PlaybackDock />}
        <ReportModal />
      </div>

      {road && (
        <div className="w-[380px] shrink-0 border-l border-ink-700 bg-ink-900 overflow-y-auto px-4 py-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={panel}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18 }}
            >
              <Suspense fallback={<div className="text-sm text-ink-400">Loading&hellip;</div>}>
                <PanelComponent />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
