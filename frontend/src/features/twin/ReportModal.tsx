import { X, Printer } from "lucide-react";
import { useStore } from "../../state/store";
import { StarRating } from "../../ui/StarRating";
import { riskColor } from "../../lib/riskColors";

const CATEGORY_LABELS: Record<string, string> = {
  geometry: "Geometry",
  traffic: "Traffic",
  infrastructure: "Infrastructure",
  pedestrian: "Pedestrian",
  visibility: "Visibility",
  environmental: "Environmental",
};

function fmtUsd(n: number) {
  return `$${n.toLocaleString("en-US")}`;
}

/** Previewable, printable risk report — built entirely from numbers this app
 * already computes and shows elsewhere (risk score/category/contributors,
 * actually-applied interventions' before/after simulation results, the
 * optimizer's actually-evaluated recommendation). Deliberately does NOT
 * invent a fixed regulatory-compliance checklist or fabricated "lives
 * saved/year" figures the way a reference implementation's audit modal does —
 * this app has no model that produces real numbers for those, and RoadTwin's
 * whole premise is that every displayed figure traces to real data or a
 * labeled estimate, never invented set-dressing. */
export function ReportModal() {
  const road = useStore((s) => s.road);
  const reportOpen = useStore((s) => s.reportOpen);
  const setReportOpen = useStore((s) => s.setReportOpen);
  const interventionResult = useStore((s) => s.interventionResult);
  const optimizeResult = useStore((s) => s.optimizeResult);

  if (!reportOpen || !road) return null;
  const { risk } = road;
  const color = riskColor(risk.category);
  const ranked = Object.entries(risk.category_totals)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  return (
    <div
      id="report-modal-root"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 print:bg-white print:p-0 print:static print:block"
      onClick={() => setReportOpen(false)}
    >
      <div
        className="surface-elevated w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 print:max-h-none print:overflow-visible print:shadow-none print:border-0 print:max-w-none print:bg-white print:text-black"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4 print:hidden">
          <div>
            <div className="chip mb-1" style={{ background: `${color}22`, color }}>Road Safety Report</div>
            <h2 className="font-display text-lg text-ink-100">{road.name}</h2>
            <div className="text-xs text-ink-400">{road.region}</div>
          </div>
          <button
            onClick={() => setReportOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/10 hover:bg-white/10 text-ink-300"
          >
            <X size={16} />
          </button>
        </div>

        <div className="hidden print:block mb-4">
          <h2 className="text-lg font-bold">{road.name} — Road Safety Report</h2>
          <div className="text-sm">{road.region}</div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="surface-card print:border print:border-black/20 p-3">
            <div className="label-caption print:text-black/60">Risk score</div>
            <div className="mono font-bold text-lg" style={{ color }}>{risk.score_0_100.toFixed(0)}<span className="text-xs text-ink-400 print:text-black/50"> /100</span></div>
          </div>
          <div className="surface-card print:border print:border-black/20 p-3">
            <div className="label-caption print:text-black/60">Safety rating</div>
            <StarRating stars={risk.stars} size={15} color={color} />
          </div>
          <div className="surface-card print:border print:border-black/20 p-3">
            <div className="label-caption print:text-black/60">Category</div>
            <div className="mono font-bold text-sm" style={{ color }}>{risk.category}</div>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-ink-300 print:text-black mb-5">{risk.summary}</p>

        <div className="mb-5">
          <div className="label-caption print:text-black/60 mb-2">Top risk contributors</div>
          <div className="space-y-1">
            {ranked.map(([cat, v]) => (
              <div key={cat} className="flex items-center justify-between text-sm">
                <span className="text-ink-300 print:text-black">{CATEGORY_LABELS[cat] ?? cat}</span>
                <span className="mono text-ink-400 print:text-black/70">{v.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>

        {interventionResult && (
          <div className="mb-5">
            <div className="label-caption print:text-black/60 mb-2">Applied interventions — simulated impact</div>
            <div className="surface-card print:border print:border-black/20 p-3 mb-2">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-ink-300 print:text-black">Risk score</span>
                <span className="mono">
                  <span className="text-ink-400 print:text-black/60">{interventionResult.before_risk.score_0_100.toFixed(0)}</span>
                  {" -> "}
                  <span style={{ color }} className="print:text-black font-semibold">{interventionResult.after_risk.score_0_100.toFixed(0)}</span>
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-300 print:text-black">Simulated conflicts</span>
                <span className="mono">
                  <span className="text-ink-400 print:text-black/60">{interventionResult.before_sim.conflict_count}</span>
                  {" -> "}
                  <span className="print:text-black font-semibold">{interventionResult.after_sim.conflict_count}</span>
                </span>
              </div>
            </div>
            <div className="space-y-1">
              {interventionResult.applied.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-xs">
                  <span className="text-ink-300 print:text-black">{a.name}</span>
                  <span className="mono text-ink-400 print:text-black/70">{fmtUsd(a.cost_estimate_usd)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {optimizeResult && (
          <div className="mb-5">
            <div className="label-caption print:text-black/60 mb-2">Optimizer recommendation ({optimizeResult.objective})</div>
            <div className="surface-card print:border print:border-black/20 p-3">
              <div className="text-sm font-semibold text-brand print:text-black mb-1">
                {optimizeResult.best.names.join(" + ") || "No change"}
              </div>
              <p className="text-xs text-ink-300 print:text-black/80 mb-2">{optimizeResult.explanation}</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-ink-500 print:text-black/50">Risk reduction</div>
                  <div className="mono font-semibold">{optimizeResult.best.risk_reduction.toFixed(1)}</div>
                </div>
                <div>
                  <div className="text-ink-500 print:text-black/50">Est. cost</div>
                  <div className="mono font-semibold">{fmtUsd(optimizeResult.best.cost_estimate_usd)}</div>
                </div>
                <div>
                  <div className="text-ink-500 print:text-black/50">Conflict reduction</div>
                  <div className="mono font-semibold">{optimizeResult.best.est_conflict_reduction_pct.toFixed(0)}%</div>
                </div>
              </div>
              <div className="text-2xs text-ink-500 print:text-black/50 mt-2">
                Evaluated {optimizeResult.evaluated.length} combinations exhaustively (brute-force search).
              </div>
            </div>
          </div>
        )}

        <div className="text-2xs leading-relaxed text-ink-500 print:text-black/60 border-t border-ink-700 print:border-black/20 pt-3 mb-4">
          RoadTwin provides analytical risk estimates and simulation-based recommendations. It is not an
          official road-safety certification or engineering assessment.
        </div>

        <button
          onClick={() => window.print()}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-brand text-ink-950 text-sm font-semibold hover:bg-brand-bright transition-colors print:hidden"
        >
          <Printer size={15} /> Print / Save as PDF
        </button>
      </div>
    </div>
  );
}
