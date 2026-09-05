import { useState } from "react";
import { useStore } from "../../state/store";
import { StarRating } from "../common/StarRating";
import { Bar } from "../common/Bar";
import { riskColor } from "../../three/geometryUtils";
import { AlertTriangle, ChevronRight, ChevronDown } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  geometry: "Geometry",
  traffic: "Traffic",
  infrastructure: "Infrastructure",
  pedestrian: "Pedestrian",
  visibility: "Visibility",
  environmental: "Environmental",
};

export function RiskPanel() {
  const road = useStore((s) => s.road);
  const setPanel = useStore((s) => s.setPanel);
  const [showAll, setShowAll] = useState(false);
  if (!road) return null;
  const { risk } = road;
  const color = riskColor(risk.category);
  const maxCat = Math.max(...Object.values(risk.category_totals), 1);

  const ranked = Object.entries(risk.category_totals)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);
  const top3 = ranked.slice(0, 3);
  const rest = ranked.slice(3);

  return (
    <div className="fade-in-up">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-xs uppercase tracking-wider text-base-300 font-semibold">Road Risk Estimate</h2>
        <span className="mono text-[10px] text-base-400">
          {road.source === "osm" ? "LIVE OSM" : road.source === "osrm" ? "LIVE OSRM ROUTE" : "DEMO DATA"}
        </span>
      </div>

      <div className="flex items-center gap-3 mb-1">
        <StarRating stars={risk.stars} size={26} />
        <span className="mono text-2xl font-bold" style={{ color }}>{risk.stars.toFixed(1)}</span>
        <span className="text-base-400 text-sm">/ 5</span>
      </div>
      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide mb-4"
           style={{ background: `${color}22`, color }}>
        <AlertTriangle size={12} /> {risk.category}
      </div>

      <div className="mono text-[11px] text-base-400 mb-4 flex items-center justify-between">
        <span>Risk score</span>
        <span className="text-base-200">{risk.score_0_100.toFixed(0)} / 100</span>
      </div>

      <p className="text-[12.5px] leading-relaxed text-base-300 mb-4">{risk.summary}</p>

      {/* Floating glass card: top 3 contributors called out explicitly, the rest
          tucked behind a one-click accordion instead of six stacked bars up front. */}
      <div className="backdrop-blur-md bg-black/80 border border-white/10 rounded-xl p-4">
        <div className="text-[10px] uppercase tracking-wider text-base-400 mb-3">Top risk contributors</div>
        {top3.map(([cat, v]) => (
          <Bar key={cat} label={CATEGORY_LABELS[cat] ?? cat} value={v} max={maxCat} color={color} />
        ))}

        {rest.length > 0 && (
          <>
            <button
              onClick={() => setShowAll((s) => !s)}
              className="mt-1 w-full flex items-center justify-between text-[11px] text-base-400 hover:text-base-200 transition-colors py-1.5"
            >
              <span>{showAll ? "Hide" : "Show"} {rest.length} more factor{rest.length > 1 ? "s" : ""}</span>
              <ChevronDown size={14} className={`transition-transform ${showAll ? "rotate-180" : ""}`} />
            </button>
            {showAll && (
              <div className="pt-1">
                {rest.map(([cat, v]) => (
                  <Bar key={cat} label={CATEGORY_LABELS[cat] ?? cat} value={v} max={maxCat} color={color} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <button
        onClick={() => setPanel("why")}
        className="mt-3 w-full flex items-center justify-between px-3 py-2.5 rounded-md bg-base-800 hover:bg-base-700 border border-base-600 text-sm font-medium transition-colors"
      >
        Why is this road risky? <ChevronRight size={16} />
      </button>

      <div className="mt-4 text-[10px] leading-relaxed text-base-500 border-t border-base-700 pt-3">
        RoadTwin provides analytical risk estimates and simulation-based recommendations. It is not an
        official road-safety certification or engineering assessment.
      </div>
    </div>
  );
}
