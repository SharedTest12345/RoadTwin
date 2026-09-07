import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WeatherPreset } from "../../../state/store";
import type { Road } from "../../../types";
import { buildPath, pathWorldBounds, roadHalfWidth } from "../../../three/geometryUtils";
import { createTerrainHeightSampler, terrainSeedFor, EMBANKMENT_DROP } from "../../../three/terrainHeight";

// Target drops per square world-unit of ground — tuned against the OLD fixed
// 260x260 box's 9000 count (9000 / 260^2 ~= 0.133) so a road that happens to
// fit in a small area still looks the same as before; a long route (up to
// ~2260 units across including Terrain.tsx's margin) is allowed to thin out
// a little rather than paying for the ~80x more particles uniform density
// would need, capped so the per-frame JS position update stays cheap.
const RAIN_DENSITY_PER_UNIT2 = 0.133;
const RAIN_MIN_COUNT = 4000;
const RAIN_MAX_COUNT = 20000;
const RAIN_FALL_SPEED = 150;
const RAIN_STREAK_LEN = 2.6; // vertical drop length, in world units
// Extra span past the road's own bounds so rain doesn't visibly start/stop at
// a hard edge right where the visible terrain patch happens to end.
const RAIN_MARGIN_M = 260;
const RAIN_HEIGHT_MIN = 140;
const RAIN_GROUND_BUFFER = 8; // extra headroom below the lowest possible ground point

/** Falling rain, visible only in the "rain" weather preset. Each drop is a
 * short vertical LINE SEGMENT (two vertices, top and bottom), not a round
 * point sprite — round dots at any density/count still read as drizzle or
 * snow, since a real downpour reads by its STREAKS. A plain THREE.LineSegments
 * system is cheap enough to run alongside the rest of the scene; wraps
 * particles back to the top once they pass baseY instead of spawning/
 * despawning (avoids any GC churn in the render loop).
 *
 * Sized/centered on the road's OWN world bounds (same box Terrain.tsx builds
 * its ground plane from), not a fixed small box at world origin — a road's
 * local frame is centered on its own centroid (see feature_extraction.py's
 * ref_lat/ref_lon), so a long real route's far end can sit 1000+ units from
 * origin, well outside a fixed 260-unit box.
 *
 * baseY/height are likewise derived from the road's REAL elevation range
 * (see WeatherEffects below) instead of assuming ground sits at world y=0 —
 * a descending/climbing road (buildPath's totalDrop) or hilly terrain (fBm
 * ridge noise, see terrainHeight.ts) can put the actual ground well above or
 * below y=0, which is what made rain visibly stop mid-air / never reach the
 * visible terrain: drops were wrapping at a fixed y=0 that had nothing to do
 * with where the ground actually was under them. */
function Rain({
  centerX, centerZ, spreadX, spreadZ, baseY, height,
}: {
  centerX: number; centerZ: number; spreadX: number; spreadZ: number; baseY: number; height: number;
}) {
  const ref = useRef<THREE.LineSegments>(null);

  const count = useMemo(() => {
    const area = spreadX * spreadZ;
    return Math.max(RAIN_MIN_COUNT, Math.min(RAIN_MAX_COUNT, Math.round(area * RAIN_DENSITY_PER_UNIT2)));
  }, [spreadX, spreadZ]);

  const positions = useMemo(() => {
    // 2 vertices (top, bottom) per drop, 3 floats each.
    const arr = new Float32Array(count * 2 * 3);
    for (let i = 0; i < count; i++) {
      const x = centerX + (Math.random() - 0.5) * spreadX;
      const z = centerZ + (Math.random() - 0.5) * spreadZ;
      const yTop = baseY + Math.random() * height;
      const base = i * 6;
      arr[base] = x; arr[base + 1] = yTop; arr[base + 2] = z;
      arr[base + 3] = x; arr[base + 4] = yTop - RAIN_STREAK_LEN; arr[base + 5] = z;
    }
    return arr;
  }, [count, centerX, centerZ, spreadX, spreadZ, baseY, height]);

  useFrame((_, delta) => {
    const geom = ref.current?.geometry;
    if (!geom) return;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const fall = RAIN_FALL_SPEED * delta;
    for (let i = 0; i < count; i++) {
      const base = i * 6;
      let yTop = pos.array[base + 1] - fall;
      if (yTop < baseY) yTop += height;
      pos.array[base + 1] = yTop;
      pos.array[base + 4] = yTop - RAIN_STREAK_LEN;
    }
    pos.needsUpdate = true;
  });

  // Keyed by count: the underlying buffer's vertex count is fixed at creation
  // (a new Float32Array), so a differently-sized road needs a fresh geometry
  // rather than trying to resize the existing one in place.
  return (
    <lineSegments key={count} ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#c9dcf0" transparent opacity={0.75} />
    </lineSegments>
  );
}

export function WeatherEffects({ preset, road }: { preset: WeatherPreset; road: Road }) {
  const points = useMemo(() => buildPath(road), [road]);
  const bounds = useMemo(() => pathWorldBounds(points), [points]);
  const halfWidth = roadHalfWidth(road);
  const isHilly = road.features.slope_pct > 5;
  // Same ground-truth sampler Terrain.tsx/Scenery.tsx build (identical seed
  // via terrainSeedFor) — only its `ridgeAmplitude` is needed here, to bound
  // how far the fBm noise can push real ground height above/below the road's
  // own authored elevation profile.
  const ridgeAmplitude = useMemo(
    () => createTerrainHeightSampler(points, halfWidth, isHilly, terrainSeedFor(road.id, points.length)).ridgeAmplitude,
    [points, halfWidth, isHilly, road.id]
  );

  if (preset !== "rain") return null;

  // terrainHeight.ts's real formula: height = elev - EMBANKMENT_DROP + ridge*t,
  // ridge in [-ridgeAmplitude, ridgeAmplitude] — this is that same range's
  // worst case in both directions, across the road's own elevation profile.
  const groundLow = bounds.minElev - EMBANKMENT_DROP - ridgeAmplitude - RAIN_GROUND_BUFFER;
  const groundHigh = bounds.maxElev - EMBANKMENT_DROP + ridgeAmplitude;
  const baseY = groundLow;
  const height = Math.max(RAIN_HEIGHT_MIN, groundHigh - groundLow + 40);

  return (
    <Rain
      centerX={bounds.centerX}
      centerZ={bounds.centerZ}
      spreadX={Math.max(500, bounds.maxX - bounds.minX) + RAIN_MARGIN_M * 2}
      spreadZ={Math.max(500, bounds.maxZ - bounds.minZ) + RAIN_MARGIN_M * 2}
      baseY={baseY}
      height={height}
    />
  );
}
