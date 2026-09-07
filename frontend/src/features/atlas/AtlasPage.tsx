import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useStore } from "../../state/store";
import { AtlasMap } from "./AtlasMap";
import { RoadPreviewCard } from "./RoadPreviewCard";
import { StatTile } from "../../ui/StatTile";
import { riskColor } from "../../lib/riskColors";
import type { RoadSummary } from "../../types";
import { Search, Loader2, Shuffle } from "lucide-react";

const LEGEND = [
  { label: "Critical", category: "CRITICAL" },
  { label: "High", category: "HIGH" },
  { label: "Moderate", category: "MODERATE" },
  { label: "Low", category: "LOW" },
];

const CATEGORY_FILTERS = ["All", "CRITICAL", "HIGH", "MODERATE", "LOW"] as const;
type CategoryFilter = (typeof CATEGORY_FILTERS)[number];

export function AtlasPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const knownRoads = useStore((s) => s.knownRoads);
  const knownRoadsLoading = useStore((s) => s.knownRoadsLoading);
  const knownRoadsError = useStore((s) => s.knownRoadsError);
  const loadKnownRoads = useStore((s) => s.loadKnownRoads);
  const scanNewRoad = useStore((s) => s.scanNewRoad);
  const scanning = useStore((s) => s.scanning);

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!knownRoads && !knownRoadsLoading) loadKnownRoads();
  }, [knownRoads, knownRoadsLoading, loadKnownRoads]);

  // A road just scanned from elsewhere (TopNav's "Scan Random Road", which
  // navigates here with the new road's id) arrives via location state — select
  // it the same way clicking any existing marker would, so it's "marked" the
  // same way, then clear the state so a later revisit/refresh doesn't re-select it.
  useEffect(() => {
    const id = (location.state as { selectedRoadId?: string } | null)?.selectedRoadId;
    if (id) {
      setSelectedId(id);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const scanNew = async () => {
    const road = await scanNewRoad();
    if (road) setSelectedId(road.id);
  };

  // Legacy deep links land here (this is "/"): ?autodemo=<id> / bare
  // ?autodemo, and the previous ?road=<id> scheme — both now just forward
  // into the /twin/:roadId route, which owns the actual fetch.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("autodemo")) {
      const id = params.get("autodemo");
      navigate(`/twin/${id ? encodeURIComponent(id) : "new"}`, { replace: true });
      return;
    }
    const roadId = params.get("road");
    if (roadId) navigate(`/twin/${encodeURIComponent(roadId)}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roads = knownRoads ?? [];

  const stats = useMemo(() => {
    if (roads.length === 0) return null;
    const avgRisk = roads.reduce((a, r) => a + r.risk_score, 0) / roads.length;
    const liveCount = roads.filter((r) => r.source !== "demo").length;
    const counts: Record<string, number> = { CRITICAL: 0, HIGH: 0, MODERATE: 0, LOW: 0 };
    for (const r of roads) counts[r.category] = (counts[r.category] ?? 0) + 1;
    return { avgRisk, liveCount, counts };
  }, [roads]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roads.filter((r: RoadSummary) => {
      if (categoryFilter !== "All" && r.category !== categoryFilter) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.region.toLowerCase().includes(q);
    });
  }, [roads, query, categoryFilter]);

  const selected = roads.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="flex-1 relative bg-ink-950">
      {roads.length > 0 && (
        <AtlasMap roads={filtered} selectedId={selectedId} onSelect={setSelectedId} />
      )}

      {/* Command-center panel: what RoadTwin knows right now, plus the way to
          add to it — kept to one compact card rather than scattering several
          floating boxes across the map. */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="absolute top-4 left-4 z-[1000] w-[320px]"
      >
        <div className="surface-elevated p-4">
          <div className="label-caption mb-1">Road Risk Intelligence</div>
          <h1 className="font-display text-xl text-ink-100 mb-1">Roads RoadTwin has analyzed</h1>
          <p className="text-xs text-ink-400 leading-relaxed mb-3">
            Click a road to preview its risk estimate, then open its full digital twin.
          </p>

          {stats && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              <StatTile label="Scanned roads" value={String(roads.length)} />
              <StatTile label="Avg. risk" value={stats.avgRisk.toFixed(0)} />
              <StatTile label="Live-scanned" value={String(stats.liveCount)} />
            </div>
          )}

          <button
            onClick={scanNew}
            disabled={scanning}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-brand text-ink-950 font-bold text-sm hover:bg-brand-bright transition-colors disabled:opacity-60"
          >
            {scanning ? <Loader2 size={14} className="animate-spin" /> : <Shuffle size={14} />}
            Scan New Road
          </button>
        </div>
      </motion.div>

      <div className="absolute top-4 right-4 z-[1000] w-64">
        <div className="flex items-center gap-2 bg-ink-900/90 backdrop-blur border border-ink-700 rounded-lg px-3 py-2">
          <Search size={14} className="text-ink-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search roads or regions…"
            className="bg-transparent outline-none text-sm w-full placeholder:text-ink-500"
          />
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2">
          {CATEGORY_FILTERS.map((cat) => {
            const active = categoryFilter === cat;
            const color = cat === "All" ? undefined : riskColor(cat);
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className="chip border transition-colors"
                style={
                  active
                    ? { background: color ? `${color}26` : "rgba(0,240,255,0.15)", borderColor: color ? `${color}80` : "rgba(0,240,255,0.4)", color: color ?? "#00f0ff", boxShadow: color ? `0 0 12px ${color}33` : "0 0 12px rgba(0,240,255,0.2)" }
                    : { background: "rgba(12,18,30,0.9)", borderColor: "#1c2537", color: "#94a3b8" }
                }
              >
                {cat === "All" ? "All" : cat.charAt(0) + cat.slice(1).toLowerCase()}
                {stats && cat !== "All" && <span className="opacity-70">· {stats.counts[cat] ?? 0}</span>}
              </button>
            );
          })}
        </div>

        {roads.length > 0 && filtered.length === 0 && (
          <div className="mt-2 text-xs text-ink-400 bg-ink-900/90 border border-ink-700 rounded px-2.5 py-1.5">
            No roads match the current filters.
          </div>
        )}
      </div>

      <div className="absolute bottom-5 left-4 z-[1000] bg-ink-900/90 backdrop-blur border border-ink-700 rounded-lg px-3 py-2.5">
        <div className="label-caption mb-1.5">Estimated risk</div>
        <div className="flex items-center gap-3">
          {LEGEND.map((l) => (
            <div key={l.category} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: riskColor(l.category) }} />
              <span className="text-xs text-ink-300">{l.label}</span>
            </div>
          ))}
        </div>
        <div className="text-2xs text-ink-500 mt-2 pt-2 border-t border-ink-700 max-w-[230px] leading-relaxed">
          Analytical risk estimate, not an official safety classification.
        </div>
      </div>

      {knownRoadsLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-950/70 z-[999]">
          <div className="flex items-center gap-2 text-ink-300 text-sm">
            <Loader2 className="animate-spin" size={18} /> Loading scanned roads…
          </div>
        </div>
      )}

      {knownRoadsError && !knownRoadsLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-950/90 z-[999]">
          <div className="text-center max-w-sm">
            <p className="text-risk-high text-sm mb-3">{knownRoadsError}</p>
            <button
              onClick={loadKnownRoads}
              className="px-3 py-1.5 rounded border border-ink-600 hover:bg-ink-800 text-xs transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {!knownRoadsLoading && !knownRoadsError && roads.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-[999]">
          <div className="text-center max-w-sm">
            <p className="text-ink-400 text-sm mb-3">No scanned roads yet — RoadTwin doesn&rsquo;t know about any real roads.</p>
            <button
              onClick={scanNew}
              disabled={scanning}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-brand text-ink-950 font-bold text-sm hover:bg-brand-bright transition-colors mx-auto disabled:opacity-60"
            >
              {scanning ? <Loader2 size={14} className="animate-spin" /> : <Shuffle size={14} />}
              Scan the first road
            </button>
          </div>
        </div>
      )}

      {selected && <RoadPreviewCard road={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
