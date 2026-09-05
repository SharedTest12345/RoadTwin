import { useStore } from "../../state/store";
import { Bar } from "../common/Bar";
import { riskColor } from "../../three/geometryUtils";
import { ChevronLeft, Wrench } from "lucide-react";

export function WhyPanel() {
  const road = useStore((s) => s.road);
  const setPanel = useStore((s) => s.setPanel);
  if (!road) return null;
  const { risk, features } = road;
  const color = riskColor(risk.category);
  const maxPts = Math.max(...risk.contributions.map((c) => c.points), 1);

  return (
    <div className="fade-in-up">
      <button onClick={() => setPanel("risk")} className="flex items-center gap-1 text-[11px] text-base-400 hover:text-base-200 mb-3">
        <ChevronLeft size={14} /> Back
      </button>
      <h2 className="text-xs uppercase tracking-wider text-base-300 font-semibold mb-1">Why this rating?</h2>
      <p className="text-[12px] text-base-400 mb-4">Each factor below is a real, named contribution to the 0-100 risk score — not a black-box output.</p>

      {risk.contributions.length === 0 && (
        <div className="text-sm text-base-400">No significant risk factors detected in the available data.</div>
      )}

      {risk.contributions.map((c) => (
        <Bar key={c.factor} label={c.description} value={c.points} max={maxPts} color={color} suffix=" pts" />
      ))}

      {features.estimated.length > 0 && (
        <div className="mt-4 text-[10.5px] leading-relaxed text-base-500 border-t border-base-700 pt-3">
          <span className="text-base-400 font-medium">Estimated (not directly sourced):</span>{" "}
          {features.estimated.join(", ")}. These use transparent fallback assumptions when live data is unavailable.
        </div>
      )}

      <button
        onClick={() => setPanel("interventions")}
        className="mt-4 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md bg-accent/15 hover:bg-accent/25 border border-accent/40 text-accent text-sm font-medium transition-colors"
      >
        <Wrench size={15} /> Simulate interventions
      </button>
    </div>
  );
}
