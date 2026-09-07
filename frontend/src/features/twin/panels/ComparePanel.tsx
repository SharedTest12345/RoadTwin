import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid, Tooltip } from "recharts";
import { useStore } from "../../../state/store";
import { StarRating } from "../../../ui/StarRating";
import { riskColor } from "../../../lib/riskColors";
import { ArrowDown, ArrowRight, FlaskConical, Wrench } from "lucide-react";

export function ComparePanel() {
  const result = useStore((s) => s.interventionResult);
  const road = useStore((s) => s.road);
  if (!result || !road) {
    return (
      <div className="fade-in-up text-sm text-ink-400">
        Apply an intervention to see a before / after comparison here.
      </div>
    );
  }

  const { before_risk, after_risk, before_sim, after_sim, applied } = result;
  const beforeColor = riskColor(before_risk.category);
  const afterColor = riskColor(after_risk.category);
  const riskDelta = before_risk.score_0_100 - after_risk.score_0_100;

  const data = [
    { metric: "Risk score", Before: before_risk.score_0_100, After: after_risk.score_0_100 },
    { metric: "Conflicts", Before: before_sim.conflict_count, After: after_sim.conflict_count },
    { metric: "Delay (s)", Before: before_sim.avg_delay_s, After: after_sim.avg_delay_s },
    { metric: "Avg speed", Before: before_sim.avg_speed_kmh, After: after_sim.avg_speed_kmh },
  ];

  return (
    <div className="fade-in-up">
      <h2 className="panel-title mb-1">Before / After</h2>
      <p className="text-xs text-ink-400 mb-4">Projected impact of applying the selected interventions.</p>

      {/* Current -> proposed -> projected: the causal chain made explicit
          rather than just two cards side by side with no context between them. */}
      <div className="label-caption mb-1.5">Current road</div>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 surface-card p-2.5 flex items-center justify-between" style={{ borderColor: `${beforeColor}40` }}>
          <div className="flex items-center gap-2">
            <StarRating stars={before_risk.stars} size={15} color={beforeColor} />
            <span className="mono font-bold text-sm" style={{ color: beforeColor }}>{before_risk.stars.toFixed(1)}</span>
          </div>
          <span className="chip" style={{ background: `${beforeColor}22`, color: beforeColor }}>
            {before_risk.category} · {before_risk.score_0_100.toFixed(0)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-center py-1">
        <ArrowDown size={14} className="text-ink-500" />
      </div>

      <div className="label-caption mb-1.5">Proposed intervention</div>
      <div className="flex items-center gap-2 mb-2 surface-card p-2.5">
        <Wrench size={14} className="text-brand shrink-0" />
        <span className="text-sm text-ink-200">{applied.map((a) => a.name).join(" + ") || "None"}</span>
      </div>

      <div className="flex items-center justify-center py-1">
        <ArrowDown size={14} className="text-ink-500" />
      </div>

      <div className="label-caption mb-1.5">Projected result</div>
      <div
        className="flex-1 surface-card p-2.5 flex items-center justify-between mb-2"
        style={{ borderColor: `${afterColor}50`, background: `${afterColor}0d` }}
      >
        <div className="flex items-center gap-2">
          <StarRating stars={after_risk.stars} size={15} color={afterColor} />
          <span className="mono font-bold text-sm" style={{ color: afterColor }}>{after_risk.stars.toFixed(1)}</span>
        </div>
        <span className="chip" style={{ background: `${afterColor}22`, color: afterColor }}>
          {after_risk.category} · {after_risk.score_0_100.toFixed(0)}
        </span>
      </div>

      {riskDelta !== 0 && (
        <div className={`text-xs mono text-center mb-4 font-semibold ${riskDelta > 0 ? "text-brand" : "text-risk-high"}`}>
          {riskDelta > 0 ? "▼" : "▲"} {Math.abs(riskDelta).toFixed(0)} point risk {riskDelta > 0 ? "reduction" : "increase"}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-4 text-xs mono">
        <MetricRow label="Risk" before={before_risk.score_0_100.toFixed(0)} after={after_risk.score_0_100.toFixed(0)} />
        <MetricRow label="Conflicts" before={before_sim.conflict_count} after={after_sim.conflict_count} />
        <MetricRow label="Delay" before={`${before_sim.avg_delay_s.toFixed(1)}s`} after={`${after_sim.avg_delay_s.toFixed(1)}s`} />
        <MetricRow label="Avg speed" before={`${before_sim.avg_speed_kmh.toFixed(0)}km/h`} after={`${after_sim.avg_speed_kmh.toFixed(0)}km/h`} />
      </div>

      <div className="h-44 -ml-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1c2537" vertical={false} />
            <XAxis dataKey="metric" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={{ stroke: "#2a3548" }} tickLine={false} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
            <Tooltip contentStyle={{ background: "#0c121e", border: "1px solid #2a3548", borderRadius: 6, fontSize: 11 }} />
            <Bar dataKey="Before" fill="#475569" radius={[3, 3, 0, 0]} />
            <Bar dataKey="After" fill="#00f0ff" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex items-start gap-2 text-2xs leading-relaxed text-ink-500 border-t border-ink-700 pt-3">
        <FlaskConical size={13} className="text-ink-500 shrink-0 mt-0.5" />
        <span>
          <span className="text-ink-400 font-medium">Projected simulation/model result, not a guarantee.</span>{" "}
          Traffic metrics are outputs of the IDM microsimulation, not fixed assumptions — an intervention only
          moves them if it actually changes simulated driver behavior (e.g. speed or signal control). Guardrails
          primarily affect the risk score, not the traffic simulation, since they address run-off-road risk
          rather than car-following.
        </span>
      </div>
    </div>
  );
}

function MetricRow({ label, before, after }: { label: string; before: string | number; after: string | number }) {
  return (
    <div className="bg-ink-850 border border-ink-700 rounded px-2 py-1.5">
      <div className="text-ink-400 text-2xs uppercase mb-0.5">{label}</div>
      <div className="flex items-center gap-1.5">
        <span className="text-ink-400">{before}</span>
        <ArrowRight size={10} className="text-ink-500" />
        <span className="text-brand font-semibold">{after}</span>
      </div>
    </div>
  );
}
