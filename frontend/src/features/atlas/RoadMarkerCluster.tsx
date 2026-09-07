import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import type { RoadSummary } from "../../types";
import { riskColor } from "../../lib/riskColors";

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MODERATE: 2, LOW: 1 };

/** OSM/OSRM live discovery draws from a small set of curated real-world
 * regions (see osm_provider.REGIONS / osrm_provider waypoint pairs) — repeat
 * scans of the same region land within a few km of each other, which at an
 * country-wide zoom level is sub-pixel apart. A per-road CircleMarker with a
 * fixed degree offset (the previous approach) doesn't fix this: the offset
 * is a constant number of degrees, so it shrinks to sub-pixel at low zoom and
 * over-explodes at high zoom instead of tracking actual screen distance.
 * leaflet.markercluster solves this properly — it groups by real screen-pixel
 * distance at the CURRENT zoom, so a metro's 5 scanned roads read as one
 * badged cluster country-wide and separate out into individually clickable
 * markers once zoomed into that city. Requires L.Marker (icon-based)
 * instances, not vector CircleMarkers — the clustering algorithm only
 * recognizes true markers. */
function roadIcon(color: string, selected: boolean): L.DivIcon {
  const size = selected ? 18 : 14;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #000000;box-shadow:0 0 0 1px ${color}66;"></div>`,
  });
}

function clusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const markers = cluster.getAllChildMarkers();
  let worst = "LOW";
  for (const m of markers) {
    const cat = (m.options as { category?: string }).category ?? "LOW";
    if ((SEVERITY_RANK[cat] ?? 0) > (SEVERITY_RANK[worst] ?? 0)) worst = cat;
  }
  const color = riskColor(worst);
  const count = markers.length;
  const size = 30 + Math.min(count, 20);
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};color:#000000;
                display:flex;align-items:center;justify-content:center;font:700 12px 'JetBrains Mono',monospace;
                border:2px solid #000000;box-shadow:0 0 0 1px ${color}66;">${count}</div>`,
  });
}

interface Props {
  roads: RoadSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function RoadMarkerCluster({ roads, selectedId, onSelect }: Props) {
  const map = useMap();
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const group = L.markerClusterGroup({
      maxClusterRadius: 45,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: clusterIcon,
    });
    groupRef.current = group;
    map.addLayer(group);
    return () => {
      map.removeLayer(group);
      groupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    for (const r of roads) {
      const color = riskColor(r.category);
      const marker = L.marker([r.center.lat, r.center.lon], {
        icon: roadIcon(color, r.id === selectedId),
        category: r.category,
      } as L.MarkerOptions & { category: string });
      marker.on("click", () => onSelectRef.current(r.id));
      group.addLayer(marker);
    }
  }, [roads, selectedId]);

  return null;
}
