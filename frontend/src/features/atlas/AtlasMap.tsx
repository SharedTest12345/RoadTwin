import { Fragment, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { RoadSummary } from "../../types";
import { riskColor } from "../../lib/riskColors";
import { RoadMarkerCluster } from "./RoadMarkerCluster";

// Line weight by tier — higher risk reads as a visually heavier, more
// prominent road on the map rather than a differently-colored line of the
// same weight (which is easy to miss at a glance).
const RISK_WEIGHT: Record<string, number> = { CRITICAL: 7, HIGH: 5.5, MODERATE: 4.5, LOW: 3.5 };

function FitBounds({ roads }: { roads: RoadSummary[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || roads.length === 0) return;
    const bounds: [number, number][] = roads.flatMap((r) => r.points.map((p): [number, number] => [p.lat, p.lon]));
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [70, 70], maxZoom: 12 });
      fitted.current = true;
    }
  }, [roads, map]);
  return null;
}

// Selecting a road (a marker click, or landing here right after a scan) used
// to leave the map at whatever country/region-wide zoom FitBounds set once at
// load — the selected road could be an unreadably thin line at that zoom.
// Flies in close on whichever road is actually selected, same as if the user
// had manually zoomed to it.
function FlyToSelected({ roads, selectedId }: { roads: RoadSummary[]; selectedId: string | null }) {
  const map = useMap();
  useEffect(() => {
    if (!selectedId) return;
    const road = roads.find((r) => r.id === selectedId);
    if (!road || road.points.length === 0) return;
    const bounds: [number, number][] = road.points.map((p): [number, number] => [p.lat, p.lon]);
    map.flyToBounds(bounds, { padding: [120, 120], maxZoom: 15, duration: 1.1 });
  }, [selectedId, roads, map]);
  return null;
}

interface Props {
  roads: RoadSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function AtlasMap({ roads, selectedId, onSelect }: Props) {
  return (
    <MapContainer
      center={[39.8283, -98.5795]}
      zoom={5}
      className="w-full h-full atlas-map-dark"
      zoomControl={false}
      style={{ background: "#000000" }}
    >
      {/* Plain OpenStreetMap tiles — the actual no-key-required-ever reference
          tile source, not a "free tier" that can start demanding a key later.
          A CSS invert filter (see atlas-map-dark in index.css) gets back a
          dark look without needing a paid/keyed dark tile set. */}
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        subdomains="abc"
        maxZoom={19}
      />
      <FitBounds roads={roads} />
      <FlyToSelected roads={roads} selectedId={selectedId} />
      {roads.map((r) => {
        const color = riskColor(r.category);
        const selected = r.id === selectedId;
        const positions = r.points.map((p): [number, number] => [p.lat, p.lon]);
        const weight = (RISK_WEIGHT[r.category] ?? 3.5) + (selected ? 2 : 0);
        return (
          <Fragment key={r.id}>
            {selected && (
              <Polyline positions={positions} pathOptions={{ color, weight: weight + 8, opacity: 0.2 }} />
            )}
            <Polyline
              positions={positions}
              pathOptions={{ color, weight, opacity: selected ? 1 : 0.85 }}
              eventHandlers={{ click: () => onSelect(r.id) }}
            />
          </Fragment>
        );
      })}
      {/* Real marker clustering (leaflet.markercluster) rather than a fixed
          degree-based offset — roads discovered from the same curated region
          (see osm_provider.REGIONS) can be within a few km of each other,
          which is sub-pixel apart at a country-wide zoom. This groups by real
          screen distance at the current zoom and shows a count badge,
          separating into individual clickable markers once zoomed in. */}
      <RoadMarkerCluster roads={roads} selectedId={selectedId} onSelect={onSelect} />
    </MapContainer>
  );
}
