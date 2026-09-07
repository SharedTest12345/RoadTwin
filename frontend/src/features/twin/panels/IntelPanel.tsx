import { useStore } from "../../../state/store";
import { Bar } from "../../../ui/Bar";
import { riskColor } from "../../../lib/riskColors";
import {
  ChevronLeft, Wrench, Ruler, Gauge, Car, Lightbulb, Footprints, ShieldCheck, ShieldOff,
  Waves, GraduationCap, Building2, TrafficCone, Route, TriangleAlert, CloudRain, Moon,
} from "lucide-react";

function InfoRow({ icon, label, value, positive }: { icon: React.ReactNode; label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-ink-800 last:border-0">
      <div className="flex items-center gap-2 text-ink-400 min-w-0">
        {icon}
        <span className="text-xs truncate">{label}</span>
      </div>
      <span
        className={`text-xs font-medium mono shrink-0 pl-2 ${
          positive === undefined ? "text-ink-200" : positive ? "text-brand" : "text-risk-high"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function IntelPanel() {
  const road = useStore((s) => s.road);
  const setPanel = useStore((s) => s.setPanel);
  if (!road) return null;
  const { risk, features, geometry } = road;
  const color = riskColor(risk.category);
  const maxPts = Math.max(...risk.contributions.map((c) => c.points), 1);
  const est = new Set(features.estimated);

  return (
    <div className="fade-in-up">
      <button onClick={() => setPanel("risk")} className="flex items-center gap-1 text-xs text-ink-400 hover:text-ink-200 mb-3 transition-colors">
        <ChevronLeft size={14} /> Back
      </button>
      <h2 className="panel-title mb-1">Road Intelligence</h2>
      <p className="text-xs text-ink-400 mb-4">Real, named data behind this road&rsquo;s assessment — nothing here is a black-box output.</p>

      <div className="label-caption mb-2">Overview</div>
      <div className="surface-card px-3 mb-4">
        <InfoRow icon={<Route size={13} />} label="Road class" value={features.road_class} />
        <InfoRow icon={<Ruler size={13} />} label="Length" value={`${(features.length_m / 1000).toFixed(2)} km`} />
        <InfoRow icon={<Car size={13} />} label="Lanes" value={String(features.lanes)} />
        <InfoRow
          icon={<Gauge size={13} />}
          label={`Speed limit${est.has("speed_limit_kmh") ? " (est.)" : ""}`}
          value={`${features.speed_limit_kmh.toFixed(0)} km/h`}
        />
        <InfoRow icon={<Car size={13} />} label="Traffic volume (est.)" value={`~${features.estimated_volume_vph.toFixed(0)} veh/h`} />
      </div>

      <div className="label-caption mb-2">Infrastructure</div>
      <div className="surface-card px-3 mb-4">
        <InfoRow icon={<Footprints size={13} />} label="Sidewalk" value={features.has_sidewalk ? "Present" : "Absent"} positive={features.has_sidewalk} />
        <InfoRow
          icon={<Lightbulb size={13} />}
          label={`Street lighting${est.has("has_lighting") ? " (est.)" : ""}`}
          value={features.has_lighting ? "Present" : "Absent"}
          positive={features.has_lighting}
        />
        <InfoRow
          icon={features.guardrail_present ? <ShieldCheck size={13} /> : <ShieldOff size={13} />}
          label="Guardrail"
          value={features.guardrail_present ? "Present" : "Absent"}
          positive={features.guardrail_present}
        />
        <InfoRow icon={<TrafficCone size={13} />} label="Signals nearby" value={String(features.signal_count)} />
        <InfoRow icon={<Route size={13} />} label="Crossing density" value={`${features.crossing_density_per_km.toFixed(1)} /km`} />
        <InfoRow icon={<Building2 size={13} />} label="Buildings mapped" value={String(geometry.building_footprints_xy.length)} />
        <InfoRow icon={<Waves size={13} />} label="Near water" value={features.near_water ? "Yes" : "No"} positive={!features.near_water} />
        <InfoRow icon={<GraduationCap size={13} />} label="Near school/hospital" value={features.near_school_or_hospital ? "Yes" : "No"} />
      </div>

      <div className="label-caption mb-2">Geometry</div>
      <div className="surface-card px-3 mb-4">
        <InfoRow icon={<Route size={13} />} label="Sharp turns" value={String(features.sharp_turn_count)} />
        <InfoRow icon={<Ruler size={13} />} label="Max curvature" value={`${features.max_curvature_deg_per_20m.toFixed(1)}°/20m`} />
        <InfoRow icon={<Gauge size={13} />} label={`Grade${est.has("slope_pct") ? " (est.)" : ""}`} value={`${features.slope_pct.toFixed(1)}%`} />
        <InfoRow icon={<Route size={13} />} label="Intersection density" value={`${features.intersection_density_per_km.toFixed(1)} /km`} />
      </div>

      <div className="label-caption mb-2 flex items-center gap-1.5">
        Historical crash data <span className="chip" style={{ background: "#ef444422", color: "#ef4444" }}>REAL — US-Accidents dataset</span>
      </div>
      <div className="surface-card px-3 mb-4">
        {features.accident_data_available ? (
          features.accident_count > 0 ? (
            <>
              <InfoRow icon={<TriangleAlert size={13} />} label="Recorded crashes nearby (since 2016)" value={String(features.accident_count)} positive={false} />
              <InfoRow icon={<Route size={13} />} label="Crash density (per km searched)" value={`${features.accident_per_km.toFixed(1)} /km`} />
              <InfoRow icon={<Gauge size={13} />} label="Avg. traffic impact (not injury severity)" value={`${features.accident_avg_severity.toFixed(1)} / 4`} />
              <InfoRow icon={<Moon size={13} />} label="Occurred at night" value={`${features.accident_night_pct.toFixed(0)}%`} />
              <InfoRow icon={<TrafficCone size={13} />} label="Occurred at a junction" value={`${features.accident_junction_pct.toFixed(0)}%`} />
              <InfoRow icon={<CloudRain size={13} />} label="Occurred in adverse weather" value={`${features.accident_adverse_weather_pct.toFixed(0)}%`} />
            </>
          ) : (
            <div className="text-xs text-ink-400 py-1.5">No recorded crashes within ~500m of this corridor in the dataset (2016-2023).</div>
          )
        ) : (
          <div className="text-xs text-ink-500 py-1.5">Crash-history dataset not loaded on this backend — this factor is inactive.</div>
        )}
      </div>

      <div className="label-caption mb-2">Risk factors</div>
      {risk.contributions.length === 0 && (
        <div className="text-sm text-ink-400 mb-4">No significant risk factors detected in the available data.</div>
      )}
      <div className="mb-1">
        {risk.contributions.map((c) => (
          <Bar key={c.factor} label={c.description} value={c.points} max={maxPts} color={color} suffix=" pts" />
        ))}
      </div>

      {features.estimated.length > 0 && (
        <div className="mt-3 text-2xs leading-relaxed text-ink-500 border-t border-ink-700 pt-3">
          <span className="text-ink-400 font-medium">Data confidence — estimated (not directly sourced):</span>{" "}
          {features.estimated.join(", ")}. These use transparent fallback assumptions when live data is unavailable.
        </div>
      )}

      <button
        onClick={() => setPanel("interventions")}
        className="mt-4 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md bg-brand/15 hover:bg-brand/25 border border-brand/40 text-brand text-sm font-medium transition-colors"
      >
        <Wrench size={15} /> Simulate interventions
      </button>
    </div>
  );
}
