import { useStore } from "../../state/store";
import { Play, Pause, Gauge, Users, TriangleAlert, Clock, Wrench, GitCompare, BookOpen, FileText } from "lucide-react";

const SPEEDS = [1, 2, 4];

export function PlaybackDock() {
  const sim = useStore((s) => s.sim);
  const simPlaying = useStore((s) => s.simPlaying);
  const setSimPlaying = useStore((s) => s.setSimPlaying);
  const simSpeed = useStore((s) => s.simSpeed);
  const setSimSpeed = useStore((s) => s.setSimSpeed);
  const simTime = useStore((s) => s.simTime);
  const scrubSim = useStore((s) => s.scrubSim);
  const road = useStore((s) => s.road);
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const setReportOpen = useStore((s) => s.setReportOpen);

  if (!road) return null;
  const maxT = sim?.frames.length ? sim.frames[sim.frames.length - 1].t : 0;
  const conflictHot = (sim?.metrics.conflict_count ?? 0) > 5;

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(simSpeed);
    setSimSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  };

  return (
    // Floating command deck — overlays the 3D viewport (positioned relative to
    // the canvas container, not the whole screen, so it's centered on the
    // viewport and never overlaps the sidebar) rather than a full-width strip.
    // max-w/overflow-x-auto: the dock's natural content width (scrubber +
    // metrics + 4 nav buttons) can exceed the canvas container's own width
    // once the fixed 380px side panel eats into it — without a cap here the
    // excess doesn't wrap or shrink, it silently renders UNDER the panel's
    // opaque background (a later DOM sibling painting over it), which read as
    // "the Report button is missing/cut off." Scrolling within the pill is a
    // fallback for extreme widths; DockButton hiding its label at `xl` below
    // is what actually keeps this from being needed at ordinary widths.
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-5
                     max-w-[calc(100%-2rem)] overflow-x-auto
                     bg-ink-850 border border-ink-600/70 rounded-2xl
                     shadow-panel px-6 py-3.5 text-xs">
      <button
        onClick={() => setSimPlaying(!simPlaying)}
        className={`w-8 h-8 flex items-center justify-center rounded-full border shrink-0 transition-all ${
          simPlaying
            ? "bg-brand/20 border-brand/60 text-brand"
            : "bg-white/5 border-white/15 text-ink-200 hover:bg-white/10"
        }`}
      >
        {simPlaying ? <Pause size={14} /> : <Play size={14} />}
      </button>

      <button
        onClick={cycleSpeed}
        className="mono text-2xs font-semibold w-9 h-6 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 text-ink-200 transition-colors shrink-0"
        title="Playback speed"
      >
        {simSpeed}×
      </button>

      <input
        type="range" min={0} max={maxT || 1} step={0.1} value={Math.min(simTime, maxT)}
        onChange={(e) => scrubSim(parseFloat(e.target.value))}
        className="w-36 accent-brand shrink-0"
      />
      <span className="mono text-ink-300 w-[92px] shrink-0 tracking-tight">{simTime.toFixed(1)}s / {maxT.toFixed(0)}s</span>

      <div className="h-6 w-px bg-white/10 shrink-0" />

      <div className="flex items-center gap-5 mono text-ink-200">
        <Metric icon={<Gauge size={13} />} label="Speed" value={`${sim?.metrics.avg_speed_kmh.toFixed(0) ?? "-"} km/h`} />
        <Metric icon={<Clock size={13} />} label="Delay" value={`${sim?.metrics.avg_delay_s.toFixed(1) ?? "-"}s`} />
        <Metric icon={<TriangleAlert size={13} />} label="Conflicts" value={`${sim?.metrics.conflict_count ?? "-"}`} warn={conflictHot} />
        <Metric icon={<Users size={13} />} label="Vehicles" value={`${sim?.metrics.vehicles_simulated ?? "-"}`} />
      </div>

      <div className="h-6 w-px bg-white/10 shrink-0" />

      <div className="flex items-center gap-1.5 shrink-0">
        <DockButton active={panel === "intel"} onClick={() => setPanel("intel")} icon={<BookOpen size={13} />} label="Road Intel" />
        <DockButton active={panel === "interventions"} onClick={() => setPanel("interventions")} icon={<Wrench size={13} />} label="Interventions" />
        <DockButton active={panel === "compare"} onClick={() => setPanel("compare")} icon={<GitCompare size={13} />} label="Before / After" />
        <DockButton active={false} onClick={() => setReportOpen(true)} icon={<FileText size={13} />} label="Report" />
      </div>
    </div>
  );
}

function DockButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
        active
          ? "bg-brand/20 border border-brand/50 text-brand"
          : "border border-transparent text-ink-400 hover:text-ink-100 hover:bg-white/5"
      }`}
    >
      {icon} <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

function Metric({ icon, label, value, warn }: { icon: React.ReactNode; label: string; value: string; warn?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 shrink-0 ${warn ? "text-risk-high" : ""}`}>
      {icon}
      <span className="text-ink-500 hidden lg:inline">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
