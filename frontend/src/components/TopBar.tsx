import { useStore } from "../state/store";
import { StarRating } from "./common/StarRating";
import { riskColor } from "../three/geometryUtils";
import { Shuffle, Map, Boxes, PlayCircle, Loader2 } from "lucide-react";

export function TopBar() {
  const road = useStore((s) => s.road);
  const scanning = useStore((s) => s.scanning);
  const scanRandomRoad = useStore((s) => s.scanRandomRoad);
  const loadRoadById = useStore((s) => s.loadRoadById);
  const runOptimize = useStore((s) => s.runOptimize);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);

  const runDemo = () => {
    loadRoadById("ghat_cliff_road").then(() => runOptimize("balanced"));
    setViewMode("twin");
  };

  return (
    <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-base-700 bg-base-900/95 backdrop-blur z-20">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Boxes className="text-accent" size={20} />
          <span className="font-extrabold tracking-tight text-[15px]">ROAD<span className="text-accent">TWIN</span></span>
        </div>
        <div className="h-5 w-px bg-base-700 mx-1" />
        <button
          onClick={() => setViewMode("twin")}
          className={`text-[12px] px-2.5 py-1 rounded transition-colors ${viewMode === "twin" ? "bg-base-800 text-base-100" : "text-base-400 hover:text-base-200"}`}
        >
          Digital Twin
        </button>
        <button
          onClick={() => setViewMode("priority")}
          className={`flex items-center gap-1 text-[12px] px-2.5 py-1 rounded transition-colors ${viewMode === "priority" ? "bg-base-800 text-base-100" : "text-base-400 hover:text-base-200"}`}
        >
          <Map size={12} /> Priority Map
        </button>
      </div>

      {road && viewMode === "twin" && (
        <div className="hidden md:flex items-center gap-3 text-[12px] text-base-300">
          <span className="font-medium max-w-[260px] truncate">{road.name}</span>
          <span className="text-base-500">·</span>
          <span className="text-base-400">{road.region}</span>
          <StarRating stars={road.risk.stars} size={14} />
          <span className="mono font-semibold" style={{ color: riskColor(road.risk.category) }}>{road.risk.category}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={runDemo}
          disabled={scanning}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-base-600 hover:bg-base-800 text-[12.5px] font-medium transition-colors disabled:opacity-40"
        >
          <PlayCircle size={14} /> Demo
        </button>
        <button
          onClick={scanRandomRoad}
          disabled={scanning}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-accent text-base-950 text-[12.5px] font-bold hover:bg-accent/90 transition-colors disabled:opacity-60"
        >
          {scanning ? <Loader2 size={14} className="animate-spin" /> : <Shuffle size={14} />}
          Scan Random Road
        </button>
      </div>
    </div>
  );
}
