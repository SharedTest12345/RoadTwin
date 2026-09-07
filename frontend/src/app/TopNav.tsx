import { useLocation, useNavigate } from "react-router-dom";
import { useStore } from "../state/store";
import { Shuffle, Map, Boxes, PlayCircle, Loader2, Home as HomeIcon } from "lucide-react";

const NAV_TAB_BASE = "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all";
const NAV_TAB_ACTIVE = "text-white border";
const NAV_TAB_ACTIVE_STYLE = {
  background: "#232420",
  borderColor: "#3f403f",
};
const NAV_TAB_INACTIVE = "text-ink-300 border border-transparent hover:text-white hover:bg-white/5";

export function TopNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const road = useStore((s) => s.road);
  const scanning = useStore((s) => s.scanning);
  const loadRoadById = useStore((s) => s.loadRoadById);
  const runOptimize = useStore((s) => s.runOptimize);
  const scanNewRoad = useStore((s) => s.scanNewRoad);

  const onAtlas = location.pathname === "/";
  const onTwin = location.pathname.startsWith("/twin");
  const onPriority = location.pathname === "/priority";

  const runDemo = () => {
    navigate("/twin/pch_cliff_road");
    loadRoadById("pch_cliff_road").then(() => runOptimize("balanced"));
  };

  // Lands back on the Atlas map with the new road marked like any other
  // scanned road, rather than dropping straight into its 3D twin — the user
  // opens the twin themselves from there, same as for an already-scanned road.
  const scanNew = async () => {
    const newRoad = await scanNewRoad();
    if (newRoad) navigate("/", { state: { selectedRoadId: newRoad.id } });
  };

  return (
    <div
      className="h-16 shrink-0 flex items-center justify-between px-6 border-b border-ink-600/60 z-20"
      style={{ background: "#000000" }}
    >
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 select-none">
          <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white bg-ink-800 border border-ink-600">
            <Boxes size={18} />
          </div>
          <h1 className="font-display text-xl text-white">
            ROADTWIN
          </h1>
        </div>

        <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded-xl border border-white/[0.08]">
          <button
            onClick={() => navigate("/")}
            className={`${NAV_TAB_BASE} ${onAtlas ? NAV_TAB_ACTIVE : NAV_TAB_INACTIVE}`}
            style={onAtlas ? NAV_TAB_ACTIVE_STYLE : undefined}
          >
            <HomeIcon size={13} /> Atlas
          </button>
          <button
            onClick={() => navigate(road ? `/twin/${encodeURIComponent(road.id)}` : "/twin/new")}
            className={`${NAV_TAB_BASE} ${onTwin ? NAV_TAB_ACTIVE : NAV_TAB_INACTIVE}`}
            style={onTwin ? NAV_TAB_ACTIVE_STYLE : undefined}
          >
            Digital Twin
          </button>
          <button
            onClick={() => navigate("/priority")}
            className={`${NAV_TAB_BASE} ${onPriority ? NAV_TAB_ACTIVE : NAV_TAB_INACTIVE}`}
            style={onPriority ? NAV_TAB_ACTIVE_STYLE : undefined}
          >
            <Map size={13} /> Priority Map
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={runDemo}
          disabled={scanning}
          className="hidden sm:flex items-center gap-1.5 w-9 h-9 justify-center rounded-lg border border-white/[0.08] bg-white/[0.05] hover:bg-brand/15 hover:text-brand hover:border-brand/30 text-ink-300 transition-all disabled:opacity-40"
          title="Run flagship demo"
        >
          <PlayCircle size={16} />
        </button>
        <button
          onClick={scanNew}
          disabled={scanning}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-xs font-bold transition-all disabled:opacity-60 bg-ink-800 border border-ink-600 hover:bg-ink-700"
        >
          {scanning ? <Loader2 size={14} className="animate-spin" /> : <Shuffle size={14} />}
          Scan Random Road
        </button>
      </div>
    </div>
  );
}
