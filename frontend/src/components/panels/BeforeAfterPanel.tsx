import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid, Tooltip } from "recharts";
import { useStore } from "../../state/store";
import { StarRating } from "../common/StarRating";
import { riskColor } from "../../three/geometryUtils";
import { ArrowRight } from "lucide-react";

export function BeforeAfterPanel() {
  const result = useStore((s) => s.interventionResult);
  const road = useStore((s) => s.road);
  if (!result || !road) {
    return (
      <div className="fade-in-up text-[12.5px] text-base-400">
        Apply an intervention to see a before / after comparison here.
      </div>
    );
  }

  const { before_risk, after_risk, before_sim, after_sim, applied } = result;
  const beforeColor = riskColor(before_risk.category);
  const afterColor = riskColor(after_risk.category);

  const data = [
    { metric: "Risk score", Before: before_risk.score_0_100, After: after_risk.score_0_100 },
    { metric: "Conflicts", Before: before_sim.conflict_count, After: after_sim.conflict_count },
    { metric: "Delay (s)", Before: before_sim.avg_delay_s, After: after_sim.avg_delay_s },
    { metric: "Avg speed", Before: before_sim.avg_speed_kmh, After: after_sim.avg_speed_kmh },
  ];

  return (
    <div className="fade-in-up">
      <h2 className="text-xs uppercase tracking-wider text-base-300 font-semibold mb-1">Before / After</h2>
      <p className="text-[12px] text-base-400 mb-3">
        Applied: {applied.map((a) => a.name).join(", ") || "none"}
      </p>

      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex-1 bg-base-850 border border-base-700 rounded-md p-3 text-center">
          <div className="text-[10px] uppercase tracking-wide text-base-400 mb-1.5">Before</div>
          <StarRating stars={before_risk.stars} size={18} />
          <div className="mono text-lg font-bold mt-1" style={{ color: beforeColor }}>{before_risk.stars.toFixed(1)}</div>
          <div className="text-[10px] mt-0.5" style={{ color: beforeColor }}>{before_risk.category}</div>
        </div>
        <ArrowRight className="text-base-500 shrink-0" size={20} />
        <div className="flex-1 bg-base-850 border border-accent/40 rounded-md p-3 text-center">
          <div className="text-[10px] uppercase tracking-wide text-base-400 mb-1.5">After</div>
          <StarRating stars={after_risk.stars} size={18} />
          <div className="mono text-lg font-bold mt-1" style={{ color: afterColor }}>{after_risk.stars.toFixed(1)}</div>
          <div className="text-[10px] mt-0.5" style={{ color: afterColor }}>{after_risk.category}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4 text-[11px] mono">
        <MetricRow label="Risk" before={before_risk.score_0_100.toFixed(0)} after={after_risk.score_0_100.toFixed(0)} />
        <MetricRow label="Conflicts" before={before_sim.conflict_count} after={after_sim.conflict_count} />
        <MetricRow label="Delay" before={`${before_sim.avg_delay_s.toFixed(1)}s`} after={`${after_sim.avg_delay_s.toFixed(1)}s`} />
        <MetricRow label="Avg speed" before={`${before_sim.avg_speed_kmh.toFixed(0)}km/h`} after={`${after_sim.avg_speed_kmh.toFixed(0)}km/h`} />
      </div>

      <div className="h-44 -ml-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1b2430" vertical={false} />
            <XAxis dataKey="metric" tick={{ fill: "#8ba0b3", fontSize: 10 }} axisLine={{ stroke: "#26313f" }} tickLine={false} />
            <YAxis tick={{ fill: "#8ba0b3", fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
            <Tooltip contentStyle={{ background: "#0e131b", border: "1px solid #26313f", borderRadius: 6, fontSize: 11 }} />
            <Bar dataKey="Before" fill="#5c7186" radius={[3, 3, 0, 0]} />
            <Bar dataKey="After" fill="#3ddc97" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 text-[10px] leading-relaxed text-base-500 border-t border-base-700 pt-3">
        Traffic metrics are outputs of the IDM microsimulation, not fixed assumptions — an intervention only
        moves them if it actually changes simulated driver behavior (e.g. speed or signal control). Guardrails
        primarily affect the risk score, not the traffic simulation, since they address run-off-road risk
        rather than car-following.
      </div>
    </div>
  );
}

function MetricRow({ label, before, after }: { label: string; before: string | number; after: string | number }) {
  return (
    <div className="bg-base-850 border border-base-700 rounded px-2 py-1.5">
      <div className="text-base-400 text-[10px] uppercase mb-0.5">{label}</div>
      <div className="flex items-center gap-1.5">
        <span className="text-base-400">{before}</span>
        <ArrowRight size={10} className="text-base-500" />
        <span className="text-accent font-semibold">{after}</span>
      </div>
    </div>
  );
}
