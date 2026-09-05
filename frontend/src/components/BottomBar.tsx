import { useStore } from "../state/store";
import { Play, Pause, Gauge, Users, TriangleAlert, Clock, Wrench, GitCompare } from "lucide-react";

export function BottomBar() {
  const sim = useStore((s) => s.sim);
  const simPlaying = useStore((s) => s.simPlaying);
  const setSimPlaying = useStore((s) => s.setSimPlaying);
  const simTime = useStore((s) => s.simTime);
  const scrubSim = useStore((s) => s.scrubSim);
  const road = useStore((s) => s.road);
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);

  if (!road) return null;
  const maxT = sim?.frames.length ? sim.frames[sim.frames.length - 1].t : 0;
  const conflictHot = (sim?.metrics.conflict_count ?? 0) > 5;

  return (
    // Floating command deck — overlays the 3D viewport (positioned relative to the
    // canvas container, not the whole screen, so it's centered on the viewport and
    // never overlaps the sidebar) rather than reserving a full-width strip.
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-5
                     backdrop-blur-md bg-black/75 border border-white/10 rounded-2xl
                     shadow-2xl shadow-black/50 px-6 py-3.5 text-[12px]">
      <button
        onClick={() => setSimPlaying(!simPlaying)}
        className={`w-8 h-8 flex items-center justify-center rounded-full border shrink-0 transition-all ${
          simPlaying
            ? "bg-accent/20 border-accent/60 text-accent shadow-[0_0_12px_rgba(61,220,151,0.5)]"
            : "bg-white/5 border-white/15 text-base-200 hover:bg-white/10"
        }`}
      >
        {simPlaying ? <Pause size={14} /> : <Play size={14} />}
      </button>

      <input
        type="range" min={0} max={maxT || 1} step={0.1} value={Math.min(simTime, maxT)}
        onChange={(e) => scrubSim(parseFloat(e.target.value))}
        className="w-36 accent-accent shrink-0"
      />
      <span className="mono text-base-300 w-[92px] shrink-0 tracking-tight">{simTime.toFixed(1)}s / {maxT.toFixed(0)}s</span>

      <div className="h-6 w-px bg-white/10 shrink-0" />

      <div className="flex items-center gap-5 mono text-base-200">
        <Metric icon={<Gauge size={13} />} label="Speed" value={`${sim?.metrics.avg_speed_kmh.toFixed(0) ?? "-"} km/h`} />
        <Metric icon={<Clock size={13} />} label="Delay" value={`${sim?.metrics.avg_delay_s.toFixed(1) ?? "-"}s`} />
        <Metric icon={<TriangleAlert size={13} />} label="Conflicts" value={`${sim?.metrics.conflict_count ?? "-"}`} warn={conflictHot} />
        <Metric icon={<Users size={13} />} label="Vehicles" value={`${sim?.metrics.vehicles_simulated ?? "-"}`} />
      </div>

      <div className="h-6 w-px bg-white/10 shrink-0" />

      <div className="flex items-center gap-1.5 shrink-0">
        <DockButton active={panel === "interventions"} onClick={() => setPanel("interventions")} icon={<Wrench size={13} />} label="Interventions" />
        <DockButton active={panel === "beforeafter"} onClick={() => setPanel("beforeafter")} icon={<GitCompare size={13} />} label="Before / After" />
      </div>
    </div>
  );
}

function DockButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-medium transition-all ${
        active
          ? "bg-accent/20 border border-accent/50 text-accent shadow-[0_0_10px_rgba(61,220,151,0.35)]"
          : "border border-transparent text-base-400 hover:text-base-100 hover:bg-white/5"
      }`}
    >
      {icon} {label}
    </button>
  );
}

function Metric({ icon, label, value, warn }: { icon: React.ReactNode; label: string; value: string; warn?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 shrink-0 ${warn ? "text-risk-high" : ""}`}>
      {icon}
      <span className="text-base-500 hidden lg:inline">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
