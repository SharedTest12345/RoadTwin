import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Loader2 } from "lucide-react";
import { useStore } from "../../state/store";
import type { Road } from "../../types";

/** Dropdown to jump straight to any other already-scanned road without
 * leaving the Digital Twin view — previously the only way to switch roads
 * from here was "Scan Random Road" (a fresh scan) or navigating away to
 * Atlas/Priority Map to pick one, then back. */
export function RoadSwitcher({ road }: { road: Road }) {
  const [open, setOpen] = useState(false);
  const knownRoads = useStore((s) => s.knownRoads);
  const knownRoadsLoading = useStore((s) => s.knownRoadsLoading);
  const loadKnownRoads = useStore((s) => s.loadKnownRoads);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && knownRoads === null) loadKnownRoads();
  }, [open, knownRoads, loadKnownRoads]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const others = (knownRoads ?? []).filter((r) => r.id !== road.id);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-ink-600/70 bg-black hover:bg-ink-900 text-ink-200 text-xs font-semibold transition-colors"
      >
        Switch road <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-72 max-h-80 overflow-y-auto surface-elevated py-1.5 z-40">
          {knownRoadsLoading && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-ink-400">
              <Loader2 size={13} className="animate-spin" /> Loading scanned roads&hellip;
            </div>
          )}
          {!knownRoadsLoading && others.length === 0 && (
            <div className="px-3 py-2 text-xs text-ink-400">No other scanned roads yet.</div>
          )}
          {others.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setOpen(false);
                navigate(`/twin/${encodeURIComponent(r.id)}`);
              }}
              className="w-full text-left px-3 py-2 hover:bg-white/[0.06] transition-colors"
            >
              <div className="text-xs font-semibold text-ink-100 truncate">{r.name}</div>
              <div className="text-2xs text-ink-400 truncate">{r.region}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
