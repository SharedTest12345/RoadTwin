import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../../state/store";
import { riskColor, riskCategoryFromScore } from "../../lib/riskColors";
import { Loader2, MapPin } from "lucide-react";

// Bucket labels here are already title-cased versions of the SAME 4 tiers
// (CRITICAL/HIGH/MODERATE/LOW) risk_engine assigns per-road — riskColor()
// keyed on the upper-cased label is the same canonical color table every
// other page uses, not a second hand-maintained one.
function bucketColor(bucket: string): string {
  return riskColor(bucket.toUpperCase());
}

function fmtUsd(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function PriorityPage() {
  const navigate = useNavigate();
  const priorityMap = useStore((s) => s.priorityMap);
  const priorityLoading = useStore((s) => s.priorityLoading);
  const priorityError = useStore((s) => s.priorityError);
  const loadPriorityMap = useStore((s) => s.loadPriorityMap);

  useEffect(() => {
    if (!priorityMap) loadPriorityMap();
  }, [priorityMap, loadPriorityMap]);

  const counts = priorityMap?.counts_by_category ?? { Critical: 0, High: 0, Moderate: 0, Low: 0 };

  return (
    <div className="flex-1 relative bg-ink-950 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="mb-1 text-2xs uppercase tracking-widest text-brand font-semibold mono">Government / Infrastructure Mode</div>
        <h1 className="font-display text-2xl text-ink-100 mb-2">Road Priority Map</h1>
        <p className="text-sm text-ink-400 max-w-2xl mb-6">
          If a limited budget can only fund intervention on a handful of roads, this ranks candidates by an
          estimated priority score combining risk, traffic exposure, pedestrian exposure and cost-to-fix.
          Ranked from roads RoadTwin has actually scanned — not the illustrative demo set.
        </p>

        <div className="grid grid-cols-4 gap-3 mb-8">
          {(["Critical", "High", "Moderate", "Low"] as const).map((cat) => (
            <div key={cat} className="bg-ink-850 border border-ink-700 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: bucketColor(cat) }} />
                <span className="text-2xs uppercase tracking-wide text-ink-400">{cat}</span>
              </div>
              <div className="mono text-2xl font-bold">{counts[cat] ?? 0}</div>
            </div>
          ))}
        </div>

        {priorityLoading && (
          <div className="flex items-center gap-2 text-ink-400 py-8 justify-center">
            <Loader2 className="animate-spin" size={18} /> Ranking scanned roads…
          </div>
        )}

        {priorityError && !priorityLoading && (
          <div className="text-center py-12 border border-ink-700 rounded-lg bg-ink-850">
            <p className="text-risk-high text-sm mb-3">{priorityError}</p>
            <button
              onClick={loadPriorityMap}
              className="px-3 py-1.5 rounded border border-ink-600 hover:bg-ink-800 text-xs transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {priorityMap && !priorityLoading && priorityMap.entries.length === 0 && (
          <div className="text-center py-12 text-ink-400 text-sm border border-ink-700 rounded-lg bg-ink-850">
            No scanned roads yet to rank — scan a road first.
          </div>
        )}

        {priorityMap && !priorityLoading && priorityMap.entries.length > 0 && (
          <div className="border border-ink-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-ink-850 text-ink-400 text-2xs uppercase tracking-wide">
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
                    className="border-t border-ink-800 hover:bg-ink-850/70 cursor-pointer transition-colors"
                    onClick={() => navigate(`/twin/${encodeURIComponent(e.road_id)}`)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="mono text-ink-500 w-5 text-right">{i + 1}</span>
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: bucketColor(e.category) }} />
                        <span className="font-medium">{e.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-ink-400">{e.region}</td>
                    <td className="px-4 py-2.5 text-right mono" style={{ color: riskColor(riskCategoryFromScore(e.risk_score)) }}>
                      {e.risk_score.toFixed(0)}
                    </td>
                    <td className="px-4 py-2.5 text-right mono font-semibold">{e.priority_score.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-right mono text-ink-400">{fmtUsd(e.estimated_cost_to_fix_usd)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <MapPin size={14} className="text-ink-500 inline" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {priorityMap && (
          <p className="text-2xs text-ink-500 leading-relaxed mt-4 max-w-2xl">{priorityMap.methodology}</p>
        )}
      </div>
    </div>
  );
}
