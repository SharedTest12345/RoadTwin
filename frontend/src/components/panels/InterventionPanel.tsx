import { useStore } from "../../state/store";
import type { Objective } from "../../types";
import { Check, Sparkles, RotateCcw, Loader2 } from "lucide-react";

const OBJECTIVES: { id: Objective; label: string }[] = [
  { id: "balanced", label: "Balanced" },
  { id: "safety", label: "Safety-first" },
  { id: "traffic", label: "Traffic-first" },
  { id: "budget", label: "Budget-first" },
];

function fmtInr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

export function InterventionPanel() {
  const catalog = useStore((s) => s.catalog);
  const stagedIds = useStore((s) => s.stagedIds);
  const toggleStaged = useStore((s) => s.toggleStaged);
  const applyStaged = useStore((s) => s.applyStaged);
  const applyingIntervention = useStore((s) => s.applyingIntervention);
  const resetInterventions = useStore((s) => s.resetInterventions);
  const optimizeResult = useStore((s) => s.optimizeResult);
  const optimizing = useStore((s) => s.optimizing);
  const objective = useStore((s) => s.objective);
  const runOptimize = useStore((s) => s.runOptimize);
  const applyOptimizerBest = useStore((s) => s.applyOptimizerBest);
  const interventionResult = useStore((s) => s.interventionResult);

  const stagedCost = catalog.filter((o) => stagedIds.includes(o.id)).reduce((a, o) => a + o.cost_estimate_inr, 0);

  return (
    <div className="fade-in-up">
      <h2 className="text-xs uppercase tracking-wider text-base-300 font-semibold mb-1">Intervention Engine</h2>
      <p className="text-[12px] text-base-400 mb-3">Select interventions to preview, or let the optimizer search combinations.</p>

      <div className="space-y-1.5 mb-4">
        {catalog.map((opt) => {
          const staged = stagedIds.includes(opt.id);
          return (
            <button
              key={opt.id}
              disabled={!opt.applicable}
              onClick={() => toggleStaged(opt.id)}
              title={opt.applicable_reason ?? undefined}
              className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${
                !opt.applicable ? "opacity-40 cursor-not-allowed border-base-700 bg-base-850" :
                staged ? "border-accent/60 bg-accent/10" : "border-base-700 bg-base-850 hover:border-base-500"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded flex items-center justify-center border ${staged ? "bg-accent border-accent" : "border-base-500"}`}>
                    {staged && <Check size={11} className="text-base-950" strokeWidth={3} />}
                  </div>
                  <span className="text-[13px] font-medium">{opt.name}</span>
                </div>
                <span className="mono text-[11px] text-base-400">{fmtInr(opt.cost_estimate_inr)}</span>
              </div>
              <div className="text-[11px] text-base-400 mt-1 pl-6">{opt.description}</div>
              <div className="text-[10px] text-base-500 mt-0.5 pl-6 uppercase tracking-wide">
                {opt.category} · {opt.complexity} complexity
                {!opt.applicable && opt.applicable_reason ? ` · ${opt.applicable_reason}` : ""}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[11px] mb-2 text-base-400">
        <span>{stagedIds.length} selected</span>
        <span className="mono">{fmtInr(stagedCost)} estimated</span>
      </div>
      <div className="flex gap-2 mb-4">
        <button
          onClick={applyStaged}
          disabled={stagedIds.length === 0 || applyingIntervention}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-accent text-base-950 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
        >
          {applyingIntervention ? <Loader2 size={14} className="animate-spin" /> : null}
          Apply Selected
        </button>
        <button
          onClick={resetInterventions}
          disabled={stagedIds.length === 0 && !interventionResult}
          className="px-3 py-2 rounded-md border border-base-600 hover:bg-base-800 disabled:opacity-30"
          title="Reset to baseline"
        >
          <RotateCcw size={15} />
        </button>
      </div>

      <div className="border-t border-base-700 pt-3">
        <div className="text-[10px] uppercase tracking-wider text-base-400 mb-2">Optimizer objective</div>
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          {OBJECTIVES.map((o) => (
            <button
              key={o.id}
              onClick={() => runOptimize(o.id)}
              className={`px-2 py-1.5 rounded text-[11.5px] border transition-colors ${
                objective === o.id && optimizeResult ? "border-accent/60 bg-accent/10 text-accent" : "border-base-600 hover:bg-base-800"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {optimizing && (
          <div className="flex items-center gap-2 text-[12px] text-base-400 py-2">
            <Loader2 size={14} className="animate-spin" /> Evaluating intervention combinations…
          </div>
        )}
        {optimizeResult && !optimizing && (
          <div className="bg-base-850 border border-base-700 rounded-md p-3 mt-1">
            <div className="flex items-center gap-1.5 text-accent text-[11.5px] font-semibold mb-1.5">
              <Sparkles size={13} /> Recommended: {optimizeResult.best.names.join(" + ") || "No change"}
            </div>
            <p className="text-[11.5px] text-base-300 leading-relaxed mb-2">{optimizeResult.explanation}</p>
            <div className="text-[10.5px] text-base-500 mb-2">
              Evaluated {optimizeResult.evaluated.length} combinations exhaustively (brute-force search).
            </div>
            <button
              onClick={applyOptimizerBest}
              disabled={optimizeResult.best.intervention_ids.length === 0}
              className="w-full px-3 py-1.5 rounded bg-accent/20 border border-accent/50 text-accent text-[12px] font-medium hover:bg-accent/30 disabled:opacity-40"
            >
              Apply Recommended Combination
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 text-[10px] leading-relaxed text-base-500 border-t border-base-700 pt-3">
        Costs and complexity are estimates for prototype purposes, not engineering quotes.
      </div>
    </div>
  );
}
