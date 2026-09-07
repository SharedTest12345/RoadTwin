import { useStore } from "../../../state/store";
import type { Objective } from "../../../types";
import { Check, Sparkles, RotateCcw, Loader2, TriangleAlert } from "lucide-react";

const OBJECTIVES: { id: Objective; label: string }[] = [
  { id: "balanced", label: "Balanced" },
  { id: "safety", label: "Safety-first" },
  { id: "traffic", label: "Traffic-first" },
  { id: "budget", label: "Budget-first" },
];

function fmtUsd(n: number) {
  return `$${n.toLocaleString("en-US")}`;
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

  const stagedCost = catalog.filter((o) => stagedIds.includes(o.id)).reduce((a, o) => a + o.cost_estimate_usd, 0);

  return (
    <div className="fade-in-up">
      <h2 className="panel-title mb-1">Intervention Engine</h2>
      <p className="text-xs text-ink-400 mb-3">
        Only interventions that would actually address one of this road&rsquo;s own real risk factors are listed —
        select some to preview, or let the optimizer search combinations.
      </p>

      {catalog.length === 0 && (
        <div className="text-sm text-ink-400 mb-4">
          No applicable interventions were found — this road&rsquo;s risk factors (see Road Intel) aren&rsquo;t
          ones any item in the catalog addresses.
        </div>
      )}

      <div className="space-y-1.5 mb-4">
        {catalog.map((opt) => {
          const staged = stagedIds.includes(opt.id);
          return (
            <button
              key={opt.id}
              onClick={() => toggleStaged(opt.id)}
              className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${
                staged ? "border-brand/60 bg-brand/10" : "border-ink-700 bg-ink-850 hover:border-ink-500"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded flex items-center justify-center border ${staged ? "bg-brand border-brand" : "border-ink-500"}`}>
                    {staged && <Check size={11} className="text-ink-950" strokeWidth={3} />}
                  </div>
                  <span className="text-sm font-medium">{opt.name}</span>
                </div>
                <span className="mono text-xs text-ink-400">{fmtUsd(opt.cost_estimate_usd)}</span>
              </div>
              <div className="text-xs text-ink-400 mt-1 pl-6">{opt.description}</div>
              <div className="text-2xs text-ink-500 mt-0.5 pl-6 uppercase tracking-wide">
                {opt.category} · {opt.complexity} complexity
              </div>
              {opt.evidence && (
                <div className="flex items-start gap-1.5 text-2xs text-risk-high/90 mt-1.5 pl-6 leading-snug normal-case">
                  <TriangleAlert size={11} className="shrink-0 mt-0.5" />
                  <span><span className="font-semibold">Backed by real crash data near this road:</span> {opt.evidence}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-xs mb-2 text-ink-400">
        <span>{stagedIds.length} selected</span>
        <span className="mono">{fmtUsd(stagedCost)} estimated</span>
      </div>
      <div className="flex gap-2 mb-4">
        <button
          onClick={applyStaged}
          disabled={stagedIds.length === 0 || applyingIntervention}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-brand text-ink-950 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-bright transition-colors"
        >
          {applyingIntervention ? <Loader2 size={14} className="animate-spin" /> : null}
          Apply Selected
        </button>
        <button
          onClick={resetInterventions}
          disabled={stagedIds.length === 0 && !interventionResult}
          className="px-3 py-2 rounded-md border border-ink-600 hover:bg-ink-800 disabled:opacity-30 transition-colors"
          title="Reset to baseline"
        >
          <RotateCcw size={15} />
        </button>
      </div>

      <div className="border-t border-ink-700 pt-3">
        <div className="label-caption mb-2">Optimizer objective</div>
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          {OBJECTIVES.map((o) => (
            <button
              key={o.id}
              onClick={() => runOptimize(o.id)}
              className={`px-2 py-1.5 rounded text-xs border transition-colors ${
                objective === o.id && optimizeResult ? "border-brand/60 bg-brand/10 text-brand" : "border-ink-600 hover:bg-ink-800"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {optimizing && (
          <div className="flex items-center gap-2 text-xs text-ink-400 py-2">
            <Loader2 size={14} className="animate-spin" /> Evaluating intervention combinations…
          </div>
        )}
        {optimizeResult && !optimizing && (
          <div className="surface-card p-3 mt-1">
            <div className="flex items-center gap-1.5 text-brand text-xs font-semibold mb-1.5">
              <Sparkles size={13} /> Recommended: {optimizeResult.best.names.join(" + ") || "No change"}
            </div>
            <p className="text-xs text-ink-300 leading-relaxed mb-2">{optimizeResult.explanation}</p>
            <div className="text-2xs text-ink-500 mb-2">
              Evaluated {optimizeResult.evaluated.length} combinations exhaustively (brute-force search).
            </div>
            <button
              onClick={applyOptimizerBest}
              disabled={optimizeResult.best.intervention_ids.length === 0}
              className="w-full px-3 py-1.5 rounded bg-brand/20 border border-brand/50 text-brand text-xs font-medium hover:bg-brand/30 disabled:opacity-40 transition-colors"
            >
              Apply Recommended Combination
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 text-2xs leading-relaxed text-ink-500 border-t border-ink-700 pt-3">
        Costs and complexity are estimates for prototype purposes, not engineering quotes.
      </div>
    </div>
  );
}
