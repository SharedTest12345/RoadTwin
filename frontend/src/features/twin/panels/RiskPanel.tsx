import { useState } from "react";
import { useStore } from "../../../state/store";
import { StarRating } from "../../../ui/StarRating";
import { Bar } from "../../../ui/Bar";
import { Gauge } from "../../../ui/Gauge";
import { riskColor } from "../../../lib/riskColors";
import { AlertTriangle, ChevronRight, ChevronDown } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  geometry: "Geometry",
  traffic: "Traffic",
  infrastructure: "Infrastructure",
  pedestrian: "Pedestrian",
  visibility: "Visibility",
  environmental: "Environmental",
  historical: "Historical crash data",
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
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="panel-title">Road Risk Estimate</h2>
        <span className="source-tag">
          {road.source === "osm" ? "LIVE OSM" : road.source === "osrm" ? "LIVE OSRM ROUTE" : "DEMO DATA"}
        </span>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <Gauge score={risk.score_0_100} color={color} />
        <div className="min-w-0">
          <div className="chip mb-2.5" style={{ background: `${color}22`, color }}>
            <AlertTriangle size={12} /> {risk.category}
          </div>
          <StarRating stars={risk.stars} size={19} color={color} />
          <div className="mono font-bold text-md mt-1.5" style={{ color }}>
            {risk.stars.toFixed(1)} <span className="text-ink-400 text-xs font-normal">/ 5 safety</span>
          </div>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-ink-300 mb-4">{risk.summary}</p>

      {/* Top 3 contributors called out explicitly, the rest tucked behind a
          one-click accordion instead of six stacked bars up front. */}
      <div className="surface-card p-4">
        <div className="label-caption mb-3">Top risk contributors</div>
        {top3.map(([cat, v]) => (
          <Bar key={cat} label={CATEGORY_LABELS[cat] ?? cat} value={v} max={maxCat} color={color} />
        ))}

        {rest.length > 0 && (
          <>
            <button
              onClick={() => setShowAll((s) => !s)}
              className="mt-1 w-full flex items-center justify-between text-xs text-ink-400 hover:text-ink-200 transition-colors py-1.5"
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
        onClick={() => setPanel("intel")}
        className="mt-3 w-full flex items-center justify-between px-3 py-2.5 rounded-md bg-ink-800 hover:bg-ink-700 border border-ink-600 text-sm font-medium transition-colors"
      >
        Why is this road risky? <ChevronRight size={16} />
      </button>

      <div className="mt-4 text-2xs leading-relaxed text-ink-500 border-t border-ink-700 pt-3">
        RoadTwin provides analytical risk estimates and simulation-based recommendations. It is not an
        official road-safety certification or engineering assessment.
      </div>
    </div>
  );
}
