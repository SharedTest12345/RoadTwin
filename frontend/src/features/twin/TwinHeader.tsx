import type { Road } from "../../types";
import { StarRating } from "../../ui/StarRating";
import { riskColor } from "../../lib/riskColors";
import { RoadSwitcher } from "./RoadSwitcher";

/** Slim in-viewport header for the loaded road's identity — kept out of the
 * global TopNav so the nav bar stays identical across Atlas/Twin/Priority
 * instead of growing a road-specific section only one of the three uses. */
export function TwinHeader({ road }: { road: Road }) {
  const color = riskColor(road.risk.category);
  return (
    <div className="absolute top-4 left-4 z-30 flex items-start gap-2">
      <div className="surface-elevated px-4 py-2.5 max-w-[420px]">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-sm text-ink-100 truncate">{road.name}</span>
          <span className="source-tag shrink-0">
            {road.source === "osm" ? "OSM" : road.source === "osrm" ? "OSRM" : "DEMO"}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-ink-400 truncate">{road.region}</span>
          <StarRating stars={road.risk.stars} size={13} color={color} />
          <span className="mono text-xs font-semibold shrink-0" style={{ color }}>{road.risk.category}</span>
        </div>
      </div>
      <RoadSwitcher road={road} />
    </div>
  );
}
