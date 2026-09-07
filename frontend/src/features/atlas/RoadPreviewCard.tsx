import { useNavigate } from "react-router-dom";
import { StarRating } from "../../ui/StarRating";
import { riskColor } from "../../lib/riskColors";
import { X, ArrowRight, Gauge, Car, Footprints, Lightbulb, ShieldCheck } from "lucide-react";
import type { RoadSummary } from "../../types";

function InfraChip({ icon, label, present }: { icon: React.ReactNode; label: string; present: boolean }) {
  return (
    <div
      className={`flex items-center gap-1 px-1.5 py-1 rounded text-2xs font-medium border ${
        present ? "border-brand/40 bg-brand/10 text-brand" : "border-ink-700 bg-ink-850 text-ink-500"
      }`}
      title={`${label}: ${present ? "present" : "absent"}`}
    >
      {icon} {label}
    </div>
  );
}

export function RoadPreviewCard({ road, onClose }: { road: RoadSummary; onClose: () => void }) {
  const navigate = useNavigate();
  const color = riskColor(road.category);

  return (
    <div className="absolute bottom-5 right-4 z-[1000] w-[320px] surface-elevated p-4 fade-in-up">
      <button onClick={onClose} className="absolute top-3 right-3 text-ink-500 hover:text-ink-200 transition-colors">
        <X size={15} />
      </button>

      <div className="source-tag mb-1.5">
        {road.source === "osm" ? "LIVE OSM" : road.source === "osrm" ? "LIVE OSRM ROUTE" : "DEMO DATA"}
      </div>
      <h3 className="font-bold text-md pr-5 leading-tight">{road.name}</h3>
      <p className="text-xs text-ink-400 mb-3">{road.region}</p>

      <div className="flex items-center gap-3 mb-2">
        <StarRating stars={road.stars} size={16} color={color} />
        <span className="mono font-bold text-sm" style={{ color }}>{road.stars.toFixed(1)}</span>
      </div>
      <div className="chip mb-3" style={{ background: `${color}22`, color }}>
        {road.category} · {road.risk_score.toFixed(0)}/100
      </div>

      <p className="text-sm text-ink-300 leading-relaxed mb-3">{road.summary}</p>

      <div className="grid grid-cols-2 gap-2 text-xs mono mb-3">
        <div className="bg-ink-850 border border-ink-700 rounded px-2 py-1.5 flex items-center gap-1.5">
          <Gauge size={12} className="text-ink-400 shrink-0" /> {road.speed_limit_kmh.toFixed(0)} km/h
        </div>
        <div className="bg-ink-850 border border-ink-700 rounded px-2 py-1.5 flex items-center gap-1.5">
          <Car size={12} className="text-ink-400 shrink-0" /> ~{road.estimated_volume_vph.toFixed(0)} veh/h
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-4">
        <InfraChip icon={<Footprints size={11} />} label="Sidewalk" present={road.has_sidewalk} />
        <InfraChip icon={<Lightbulb size={11} />} label="Lighting" present={road.has_lighting} />
        <InfraChip icon={<ShieldCheck size={11} />} label="Guardrail" present={road.guardrail_present} />
      </div>

      <button
        onClick={() => navigate(`/twin/${encodeURIComponent(road.id)}`)}
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md bg-brand text-ink-950 font-bold text-sm hover:bg-brand-bright transition-colors"
      >
        Open Digital Twin <ArrowRight size={15} />
      </button>
    </div>
  );
}
