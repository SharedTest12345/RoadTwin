import { useEffect, useRef, useState } from "react";
import { X, Download, FileWarning } from "lucide-react";
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
  historical: "Historical crash data",
};

function fmtUsd(n: number) {
  return `$${n.toLocaleString("en-US")}`;
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

type PrintTarget = "crash" | "intervention" | null;

/** Two independently-downloadable reports, built entirely from numbers this
 * app already computes elsewhere (real crash-history stats, risk score/
 * category/contributors, actually-applied interventions' before/after
 * simulation results, the optimizer's actually-evaluated recommendation).
 * Deliberately does NOT invent a fixed regulatory-compliance checklist or
 * fabricated "lives saved/year" figures the way a reference implementation's
 * audit modal does — this app has no model that produces real numbers for
 * those, and RoadTwin's whole premise is that every displayed figure traces
 * to real data or a labeled estimate, never invented set-dressing.
 *
 * "Download as PDF" here is the browser's own print-to-PDF (same mechanism
 * the single combined report used before this split) — no PDF-generation
 * library added for it. Each button sets which section survives the upcoming
 * print pass (the other is hidden via print:hidden, not removed, so the
 * on-screen modal keeps showing both) and swaps document.title beforehand so
 * the browser's Save-as-PDF dialog suggests a sensible per-report filename,
 * restoring it afterward via the `afterprint` event. */
export function ReportModal() {
  const road = useStore((s) => s.road);
  const reportOpen = useStore((s) => s.reportOpen);
  const setReportOpen = useStore((s) => s.setReportOpen);
  const interventionResult = useStore((s) => s.interventionResult);
  const optimizeResult = useStore((s) => s.optimizeResult);

  const [printTarget, setPrintTarget] = useState<PrintTarget>(null);
  const savedTitle = useRef<string | null>(null);

  useEffect(() => {
    if (!printTarget || !road) return;
    savedTitle.current = document.title;
    const suffix = printTarget === "crash" ? "crash-history-report" : "post-intervention-report";
    document.title = `${slugify(road.name)}-${suffix}`;
    const restore = () => {
      if (savedTitle.current !== null) document.title = savedTitle.current;
      setPrintTarget(null);
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    // Let the title/DOM changes above actually commit before the browser
    // snapshots the page for printing — calling window.print() synchronously
    // in the same tick risked printing against the previous document.title.
    const t = setTimeout(() => window.print(), 30);
    return () => clearTimeout(t);
  }, [printTarget, road]);

  if (!reportOpen || !road) return null;
  const { risk, features } = road;
  const color = riskColor(risk.category);
  const ranked = Object.entries(risk.category_totals)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  const hideForIntervention = printTarget === "intervention" ? "print:hidden" : "";
  const hideForCrash = printTarget === "crash" ? "print:hidden" : "";

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
        <div className={`flex items-start justify-between mb-4 print:hidden ${hideForIntervention} ${hideForCrash}`}>
          <div>
            <div className="chip mb-1" style={{ background: `${color}22`, color }}>Road Safety Reports</div>
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

        {/* ================= Report 1: Historical Crash Report ================= */}
        <div className={hideForIntervention}>
          <div className="hidden print:block mb-4">
            <h2 className="text-lg font-bold">{road.name} — Historical Crash Report</h2>
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
            <div className="label-caption print:text-black/60 mb-2">Real recorded crashes near this road (US-Accidents dataset)</div>
            {features.accident_data_available ? (
              features.accident_count > 0 ? (
                <div className="surface-card print:border print:border-black/20 p-3 grid grid-cols-2 gap-y-1.5 text-sm">
                  <span className="text-ink-300 print:text-black">Recorded crashes since 2016</span>
                  <span className="mono text-right">{features.accident_count}</span>
                  <span className="text-ink-300 print:text-black">Crash density</span>
                  <span className="mono text-right">{features.accident_per_km.toFixed(1)} /km</span>
                  <span className="text-ink-300 print:text-black">Avg. traffic impact (not injury severity)</span>
                  <span className="mono text-right">{features.accident_avg_severity.toFixed(1)} /4</span>
                  <span className="text-ink-300 print:text-black">Occurred at night</span>
                  <span className="mono text-right">{features.accident_night_pct.toFixed(0)}%</span>
                  <span className="text-ink-300 print:text-black">Occurred at a junction</span>
                  <span className="mono text-right">{features.accident_junction_pct.toFixed(0)}%</span>
                  <span className="text-ink-300 print:text-black">Occurred in adverse weather</span>
                  <span className="mono text-right">{features.accident_adverse_weather_pct.toFixed(0)}%</span>
                </div>
              ) : (
                <div className="text-xs text-ink-400 print:text-black/70">No recorded crashes within ~500m of this corridor in the dataset (2016–2023).</div>
              )
            ) : (
              <div className="text-xs text-ink-500 print:text-black/50">Crash-history dataset not loaded on this backend.</div>
            )}
          </div>

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

          <div className="text-2xs leading-relaxed text-ink-500 print:text-black/60 border-t border-ink-700 print:border-black/20 pt-3 mb-4">
            Source: Kaggle US-Accidents dataset (7,728,394 US crashes, 2016–2023). RoadTwin provides analytical risk
            estimates, not an official road-safety certification or engineering assessment.
          </div>

          <button
            onClick={() => setPrintTarget("crash")}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-brand text-ink-950 text-sm font-semibold hover:bg-brand-bright transition-colors print:hidden"
          >
            <Download size={15} /> Download Crash History Report (PDF)
          </button>
        </div>

        {/* ================= Report 2: Post-Intervention Report ================= */}
        <div className={`mt-6 pt-6 border-t border-ink-700 print:border-0 print:mt-0 print:pt-0 ${hideForCrash}`}>
          <div className="hidden print:block mb-4">
            <h2 className="text-lg font-bold">{road.name} — Post-Intervention Safety Report</h2>
            <div className="text-sm">{road.region}</div>
          </div>

          {interventionResult ? (
            <>
              <div className="label-caption print:text-black/60 mb-2">Applied interventions — simulated impact</div>
              <div className="surface-card print:border print:border-black/20 p-3 mb-2">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-ink-300 print:text-black">Risk score</span>
                  <span className="mono">
                    <span className="text-ink-400 print:text-black/60">{interventionResult.before_risk.score_0_100.toFixed(0)}</span>
                    {" -> "}
                    <span style={{ color: riskColor(interventionResult.after_risk.category) }} className="print:text-black font-semibold">
                      {interventionResult.after_risk.score_0_100.toFixed(0)}
                    </span>
                    <span className="text-ink-500 print:text-black/50"> ({interventionResult.before_risk.category} → {interventionResult.after_risk.category})</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-ink-300 print:text-black">Safety rating</span>
                  <span className="mono">
                    <span className="text-ink-400 print:text-black/60">{interventionResult.before_risk.stars.toFixed(1)}★</span>
                    {" -> "}
                    <span className="print:text-black font-semibold">{interventionResult.after_risk.stars.toFixed(1)}★</span>
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
              <div className="space-y-1 mb-5">
                {interventionResult.applied.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-xs">
                    <span className="text-ink-300 print:text-black">{a.name}</span>
                    <span className="mono text-ink-400 print:text-black/70">{fmtUsd(a.cost_estimate_usd)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs font-semibold pt-1 border-t border-ink-700 print:border-black/20 mt-1">
                  <span className="text-ink-300 print:text-black">Total</span>
                  <span className="mono">{fmtUsd(interventionResult.applied.reduce((s, a) => s + a.cost_estimate_usd, 0))}</span>
                </div>
              </div>

              {optimizeResult && (
                <div className="mb-5">
                  <div className="label-caption print:text-black/60 mb-2">Optimizer recommendation ({optimizeResult.objective})</div>
                  <div className="surface-card print:border print:border-black/20 p-3">
                    <div className="text-sm font-semibold text-brand print:text-black mb-1">
                      {optimizeResult.best.names.join(" + ") || "No change"}
                    </div>
                    <p className="text-xs text-ink-300 print:text-black/80 mb-2">{optimizeResult.explanation}</p>
                    <div className="text-2xs text-ink-500 print:text-black/50 mt-2">
                      Evaluated {optimizeResult.evaluated.length} combinations exhaustively (brute-force search).
                    </div>
                  </div>
                </div>
              )}

              <div className="text-2xs leading-relaxed text-ink-500 print:text-black/60 border-t border-ink-700 print:border-black/20 pt-3 mb-4">
                Projected simulation/model result, not a guarantee. Historical crash record (if present above) is
                unaffected by these interventions — real crash history isn't reduced by a hypothetical future fix.
              </div>

              <button
                onClick={() => setPrintTarget("intervention")}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-brand text-ink-950 text-sm font-semibold hover:bg-brand-bright transition-colors print:hidden"
              >
                <Download size={15} /> Download Post-Intervention Report (PDF)
              </button>
            </>
          ) : (
            <div className="flex items-start gap-2 text-sm text-ink-400 print:hidden">
              <FileWarning size={16} className="shrink-0 mt-0.5 text-ink-500" />
              <span>Apply an intervention (or the optimizer&rsquo;s recommendation) first — this report only exists once there&rsquo;s a real before/after to show.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
