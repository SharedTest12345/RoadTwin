import { useEffect } from "react";
import { useStore } from "../../state/store";
import { riskColor, riskCategoryFromScore } from "../../three/geometryUtils";
import { Loader2, MapPin } from "lucide-react";

// Bucket labels here are already title-cased versions of the SAME 4 tiers
// (CRITICAL/HIGH/MODERATE/LOW) risk_engine assigns per-road — riskColor()
// keyed on the upper-cased label is the same canonical color table every
// other panel uses, not a second hand-maintained one.
function bucketColor(bucket: string): string {
  return riskColor(bucket.toUpperCase());
}

function fmtInr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function PriorityMapPanel() {
  const priorityMap = useStore((s) => s.priorityMap);
  const priorityLoading = useStore((s) => s.priorityLoading);
  const loadPriorityMap = useStore((s) => s.loadPriorityMap);
  const loadRoadById = useStore((s) => s.loadRoadById);
  const setViewMode = useStore((s) => s.setViewMode);

  useEffect(() => {
    if (!priorityMap) loadPriorityMap();
  }, [priorityMap, loadPriorityMap]);

  const counts = priorityMap?.counts_by_category ?? { Critical: 0, High: 0, Moderate: 0, Low: 0 };

  return (
    <div className="absolute inset-0 bg-base-950 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="mb-1 text-[11px] uppercase tracking-widest text-accent font-semibold">Government / Infrastructure Mode</div>
        <h1 className="text-2xl font-bold mb-2">Road Priority Map</h1>
        <p className="text-sm text-base-400 max-w-2xl mb-6">
          If a limited budget can only fund intervention on a handful of roads, this ranks candidates by an
          estimated priority score combining risk, traffic exposure, pedestrian exposure and cost-to-fix.
        </p>

        <div className="grid grid-cols-4 gap-3 mb-8">
          {(["Critical", "High", "Moderate", "Low"] as const).map((cat) => (
            <div key={cat} className="bg-base-850 border border-base-700 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: bucketColor(cat) }} />
                <span className="text-[11px] uppercase tracking-wide text-base-400">{cat}</span>
              </div>
              <div className="mono text-2xl font-bold">{counts[cat] ?? 0}</div>
            </div>
          ))}
        </div>

        {priorityLoading && (
          <div className="flex items-center gap-2 text-base-400 py-8 justify-center">
            <Loader2 className="animate-spin" size={18} /> Ranking road segments…
          </div>
        )}

        {priorityMap && !priorityLoading && (
          <div className="border border-base-700 rounded-lg overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-base-850 text-base-400 text-[10.5px] uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Road</th>
                  <th className="text-left px-4 py-2.5 font-medium">Region</th>
                  <th className="text-right px-4 py-2.5 font-medium">Risk</th>
                  <th className="text-right px-4 py-2.5 font-medium">Priority</th>
                  <th className="text-right px-4 py-2.5 font-medium">Est. cost to fix</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {priorityMap.entries.map((e, i) => (
                  <tr
                    key={e.road_id}
                    className="border-t border-base-800 hover:bg-base-850/70 cursor-pointer transition-colors"
                    onClick={() => { loadRoadById(e.road_id); setViewMode("twin"); }}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="mono text-base-500 w-5 text-right">{i + 1}</span>
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: bucketColor(e.category) }} />
                        <span className="font-medium">{e.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-base-400">{e.region}</td>
                    <td className="px-4 py-2.5 text-right mono" style={{ color: riskColor(riskCategoryFromScore(e.risk_score)) }}>
                      {e.risk_score.toFixed(0)}
                    </td>
                    <td className="px-4 py-2.5 text-right mono font-semibold">{e.priority_score.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-right mono text-base-400">{fmtInr(e.estimated_cost_to_fix_inr)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <MapPin size={14} className="text-base-500 inline" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {priorityMap && (
          <p className="text-[10.5px] text-base-500 leading-relaxed mt-4 max-w-2xl">{priorityMap.methodology}</p>
        )}
      </div>
    </div>
  );
}
