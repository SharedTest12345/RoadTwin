import { useMemo } from "react";
import { useGLTF, Clone } from "@react-three/drei";
import * as THREE from "three";
import type { Road } from "../../types";
import { buildPath, toWorld, perpendicular, seededRng, sampleAlongPath } from "../../three/geometryUtils";
import { buildingTextures } from "../../three/textures";
import { TREE_MODELS, BUILDING_MODELS } from "../../three/sceneryModels";
import { createTerrainHeightSampler, terrainSeedFor } from "../../three/terrainHeight";

interface TreeSpec { pos: [number, number, number]; rotY: number; scale: number; model: number }
interface BuildingSpec { pos: [number, number, number]; rotY: number; scale: number; model: number }


/** Real OSM building footprints, extruded to their actual outline (not a random
 * box or a generic model). `ring` is already in the road's local meter frame
 * from the backend — a Shape built from (x, y) directly, extruded and rotated
 * -90 about X, lands at world (x, height, -y), matching `toWorld`'s
 * (x, y, elev) -> (x, elev, -y). */
function RealBuildings({
  road, points, terrainHeight,
}: {
  road: Road;
  points: ReturnType<typeof buildPath>;
  terrainHeight: (wx: number, wz: number) => number;
}) {
  const rng = useMemo(() => seededRng(road.id + ":realbuildings"), [road.id]);
  const facadeSets = useMemo(() => {
    return [0, 1, 2, 3].map((seed) => {
      const { map, emissiveMap } = buildingTextures(seed + 101, true);
      // ExtrudeGeometry's default UV generator maps side walls in absolute shape
      // units (meters), not 0-1 per face like BoxGeometry — at repeat=(1,1) a 12m
      // wall tiled the window grid ~12x, shrinking windows to noise. A small fixed
      // repeat gets back to roughly one grid per wall.
      map.repeat.set(0.09, 0.09);
      emissiveMap.repeat.set(0.09, 0.09);
      return { map, emissiveMap };
    });
  }, []);

  const built = useMemo(() => {
    return road.geometry.building_footprints_xy.map((ring, i) => {
      const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const [bwx, , bwz] = toWorld(cx, cy, 0);
      const groundElev = terrainHeight(bwx, bwz);
      const height = 6 + rng() * 20;
      const geom = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
      return { geom, groundElev, variant: i % facadeSets.length };
    });
  }, [road.geometry.building_footprints_xy, road.id, points, rng, facadeSets.length, terrainHeight]);

  return (
    <group>
      {built.map((b, i) => (
        <mesh key={i} geometry={b.geom} position={[0, b.groundElev, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <meshStandardMaterial
            map={facadeSets[b.variant].map}
            emissiveMap={facadeSets[b.variant].emissiveMap}
            emissive="#ffffff"
            emissiveIntensity={0.35}
            roughness={0.75}
            metalness={0.1}
          />
        </mesh>
      ))}
    </group>
  );
}

export function Scenery({ road }: { road: Road }) {
  const points = useMemo(() => buildPath(road), [road]);
  const halfWidth = Math.max(2, road.features.lanes) * 1.7;
  const rng = useMemo(() => seededRng(road.id + ":scenery"), [road.id]);
  const urban = /primary|secondary|residential|tertiary|unclassified/.test(road.features.road_class) && !road.cliff_scenario;
  const hasRealBuildings = road.geometry.building_footprints_xy.length > 0;
  const isHilly = road.features.slope_pct > 5;

  const treeGltfs = useGLTF(TREE_MODELS);
  const buildingGltfs = useGLTF(BUILDING_MODELS);

  // Same ground-truth height field Terrain.tsx builds the mesh from (identical
  // seed via terrainSeedFor) — trees/buildings sit tens of units off the road
  // centerline, and the terrain there now has real hill relief (not the old
  // near-flat ripple), so placing them at the road's own elevation instead of
  // sampling the terrain at their actual offset position would float or bury
  // them the moment the ground rises or falls away from the corridor.
  const sampler = useMemo(
    () => createTerrainHeightSampler(points, halfWidth, isHilly, terrainSeedFor(road.id, points.length)),
    [points, halfWidth, isHilly, road.id]
  );

  const { trees, buildings } = useMemo(() => {
    const treeSpecs: TreeSpec[] = [];
    const bldgSpecs: BuildingSpec[] = [];
    if (points.length < 2) return { trees: treeSpecs, buildings: bldgSpecs };
    // Fixed real-world spacing rather than stepping by point-index — buildPath now
    // resamples every road to a dense, even spacing (see RESAMPLE_SPACING_M) to fix
    // ribbon twisting at sharp turns, so stepping by index would place ~15x more
    // scenery than intended on every road.
    const step = urban ? 15 : 20;
    const total = points[points.length - 1].s;
    for (let s = 0; s < total; s += step) {
      const p = sampleAlongPath(points, s);
      const [px, pz] = perpendicular(p.ribbonHeading);
      for (const side of [-1, 1]) {
        if (road.cliff_scenario && side === -1) continue; // keep the drop-off side clear
        if (rng() > (urban ? 0.55 : 0.4)) continue;
        const [wx, , wz] = toWorld(p.x, p.y, p.elev);
        const dist = halfWidth + (urban ? 6 + rng() * 5 : 4 + rng() * 10);
        const ox = wx + px * dist * side;
        const oz = wz + pz * dist * side;
        const oy = sampler.height(ox, oz);
        const rotY = rng() * Math.PI * 2;
        // Real footprints already place buildings correctly — skip generic
        // building models for urban roads that have them, keep trees either way.
        if (urban && !hasRealBuildings) {
          bldgSpecs.push({ pos: [ox, oy, oz], rotY, scale: 0.8 + rng() * 1.6, model: Math.floor(rng() * BUILDING_MODELS.length) });
        } else if (!urban) {
          treeSpecs.push({ pos: [ox, oy, oz], rotY, scale: 0.8 + rng() * 0.8, model: Math.floor(rng() * TREE_MODELS.length) });
        }
      }
    }
    return { trees: treeSpecs, buildings: bldgSpecs };
  }, [points, halfWidth, rng, urban, road.cliff_scenario, hasRealBuildings, sampler]);

  return (
    <group>
      {trees.map((t, i) => (
        <Clone
          key={i}
          object={treeGltfs[t.model].scene}
          position={t.pos}
          rotation={[0, t.rotY, 0]}
          scale={t.scale}
          castShadow
        />
      ))}
      {hasRealBuildings && <RealBuildings road={road} points={points} terrainHeight={sampler.height} />}
      {buildings.map((b, i) => (
        <Clone
          key={i}
          object={buildingGltfs[b.model].scene}
          position={b.pos}
          rotation={[0, b.rotY, 0]}
          scale={b.scale}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}

useGLTF.preload(TREE_MODELS);
useGLTF.preload(BUILDING_MODELS);
