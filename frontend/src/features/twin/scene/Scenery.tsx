import { useMemo } from "react";
import { useGLTF, Clone, Merged } from "@react-three/drei";
import * as THREE from "three";
import type { Road } from "../../../types";
import {
  buildPath, toWorld, perpendicular, seededRng, sampleAlongPath, roadHalfWidth,
  pathWorldBounds, terrainPlaneSize,
} from "../../../three/geometryUtils";
import { buildingTextures, rockTexture } from "../../../three/textures";
import { TREE_MODELS, BUILDING_MODELS } from "../../../three/sceneryModels";
import { createTerrainHeightSampler, terrainSeedFor } from "../../../three/terrainHeight";

interface TreeSpec { pos: [number, number, number]; rotY: number; scale: number; model: number }
interface BuildingSpec { pos: [number, number, number]; rotY: number; scale: number; model: number }
interface RockSpec { pos: [number, number, number]; rotY: number; scale: number; geom: number }

// Low-poly rock scatter: a handful of shared geometry variants (built once at
// module load, not per-road — it's just a shape, nothing road-specific) from a
// jittered, vertically-squashed icosahedron. Procedural rather than a GLTF like
// the tree/building models because this environment has no network access to
// fetch new assets (see sceneryModels.ts) — this needs zero new files.
function makeRockGeometry(seed: number): THREE.BufferGeometry {
  const geom = new THREE.IcosahedronGeometry(1, 1);
  const pos = geom.attributes.position as THREE.BufferAttribute;
  let h = seed;
  const rand = () => { h = (h * 9301 + 49297) % 233280; return h / 233280; };
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(0.75 + rand() * 0.45);
    pos.setXYZ(i, v.x, v.y * 0.65, v.z); // squash — rocks sit low and wide, not spherical
  }
  geom.computeVertexNormals();
  return geom;
}
const ROCK_GEOMETRIES = [101, 138, 175, 212, 249].map(makeRockGeometry);

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
      // units (meters), not 0-1 per face like BoxGeometry — a small fixed repeat
      // gets back to roughly one grid per wall.
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
      // Real footprint (x, y outline) stays untouched — that's real OSM data —
      // but OSM carries no height tag for most buildings, so this was always an
      // estimate; raised its range as a deliberate visual-scale choice.
      const height = 9 + rng() * 28;
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
  const halfWidth = roadHalfWidth(road);
  const rng = useMemo(() => seededRng(road.id + ":scenery"), [road.id]);
  const urban = /primary|secondary|residential|tertiary|unclassified/.test(road.features.road_class) && !road.cliff_scenario;
  const hasRealBuildings = road.geometry.building_footprints_xy.length > 0;
  const isHilly = road.features.slope_pct > 5;

  const treeGltfs = useGLTF(TREE_MODELS);
  const buildingGltfs = useGLTF(BUILDING_MODELS);

  // Same ground-truth height field Terrain.tsx builds the mesh from (identical
  // seed via terrainSeedFor) — trees/buildings sit tens of units off the road
  // centerline, so placing them at the road's own elevation instead of sampling
  // the terrain at their actual offset position would float or bury them the
  // moment the ground rises or falls away from the corridor.
  const sampler = useMemo(
    () => createTerrainHeightSampler(points, halfWidth, isHilly, terrainSeedFor(road.id, points.length)),
    [points, halfWidth, isHilly, road.id]
  );

  const bounds = useMemo(() => pathWorldBounds(points), [points]);
  const { sizeX, sizeZ } = terrainPlaneSize(bounds);
  const rockTex = useMemo(() => rockTexture(), []);

  // Perf: a road can carry 1000+ tree/rock instances (roadside rows + the
  // far-field scatter above), and rendering each as its own <Clone>/<mesh>
  // means that many separate draw calls + shadow casters — the actual
  // source of the lag, not the placement math. Every tree GLTF (verified via
  // GLTFLoader directly: two meshes, "woodBark" + "leafsGreen", both at
  // local-identity transform, no baked offset) and every rock (one shared
  // procedural geometry per variant) collapses into ONE InstancedMesh per
  // (model, part) via drei's <Merged> — a handful of draw calls total
  // regardless of instance count, GPU-instanced instead of CPU-duplicated.
  const treeMeshes = useMemo(() => {
    const out: Record<string, THREE.Mesh> = {};
    treeGltfs.forEach((gltf, modelIdx) => {
      let part = 0;
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          out[`t${modelIdx}_${part}`] = o as THREE.Mesh;
          part++;
        }
      });
    });
    return out;
  }, [treeGltfs]);
  const treePartsByModel = useMemo(() => {
    const byModel: string[][] = TREE_MODELS.map(() => []);
    for (const key of Object.keys(treeMeshes)) {
      const modelIdx = parseInt(key.slice(1).split("_")[0], 10);
      byModel[modelIdx]?.push(key);
    }
    return byModel;
  }, [treeMeshes]);

  const rockMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ map: rockTex, roughness: 1, metalness: 0.05 }),
    [rockTex]
  );
  const rockMeshes = useMemo(() => {
    const out: Record<string, THREE.Mesh> = {};
    ROCK_GEOMETRIES.forEach((geom, i) => { out[`r${i}`] = new THREE.Mesh(geom, rockMaterial); });
    return out;
  }, [rockMaterial]);

  const { trees, buildings, rocks } = useMemo(() => {
    const treeSpecs: TreeSpec[] = [];
    const bldgSpecs: BuildingSpec[] = [];
    const rockSpecs: RockSpec[] = [];
    if (points.length < 2) return { trees: treeSpecs, buildings: bldgSpecs, rocks: rockSpecs };

    // Flat world-space (x, z) for every point on the WHOLE road, checked
    // against every candidate placement below. Offsetting purely by the
    // LOCAL tangent at one sample point isn't enough on a tight switchback —
    // two arms of the same hairpin can sit only a few meters apart in world
    // space despite being far apart in arc-length, so a spot "clear" of the
    // arm it was sampled from can still land directly on the OTHER arm
    // passing nearby. Rejecting any candidate too close to ANY point on the
    // road (not just its own sample point) is what actually keeps props off
    // the carriageway on a switchback.
    const roadXZ: [number, number][] = points.map((rp) => {
      const [rwx, , rwz] = toWorld(rp.x, rp.y, rp.elev);
      return [rwx, rwz];
    });
    const clearOfRoad = (ox: number, oz: number, minClearance: number) => {
      for (const [rx, rz] of roadXZ) {
        if (Math.hypot(ox - rx, oz - rz) < minClearance) return false;
      }
      return true;
    };

    // Real building footprints are drawn exactly where OSM says the actual
    // house/structure sits (see RealBuildings) — without this, procedural
    // street trees (placed on a generic offset grid that knows nothing about
    // those footprints) can land INSIDE a real building's outline and read as
    // a tree growing through a house. toWorld's (x, y, elev) -> (x, elev, -y)
    // means a world (ox, oz) candidate maps back to local (ox, -oz) for the
    // point-in-polygon test against building_footprints_xy's own (x, y) rings.
    const buildingRings = road.geometry.building_footprints_xy;
    const insideAnyBuilding = (ox: number, oz: number) => {
      const lx = ox, ly = -oz;
      for (const ring of buildingRings) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i], [xj, yj] = ring[j];
          const intersects = yi > ly !== yj > ly && lx < ((xj - xi) * (ly - yi)) / (yj - yi) + xi;
          if (intersects) inside = !inside;
        }
        if (inside) return true;
      }
      return false;
    };

    const total = points[points.length - 1].s;

    // A single distance-from-road offset ring left the scene reading noticeably
    // emptier than a real roadside once routes run to real map-scale lengths —
    // a real street/highway has a near row AND buildings/trees further back
    // behind them, not one thin fringe. Two rows (front + a sparser, deeper
    // back row) at their own step/probability/distance bands, sharing the same
    // clearOfRoad rejection so the back row still calls placeRow with a
    // clearance that accounts for how far out it is.
    function placeRow(step: number, prob: number, distMin: number, distSpread: number, clearance: number) {
      for (let s = 0; s < total; s += step) {
        const p = sampleAlongPath(points, s);
        const [px, pz] = perpendicular(p.ribbonHeading);
        for (const side of [-1, 1] as const) {
          if (road.cliff_scenario && side === -1) continue; // keep the drop-off side clear
          if (rng() > prob) continue;
          const [wx, , wz] = toWorld(p.x, p.y, p.elev);
          const dist = halfWidth + distMin + rng() * distSpread;
          const ox = wx + px * dist * side;
          const oz = wz + pz * dist * side;
          if (!clearOfRoad(ox, oz, clearance)) continue;
          const oy = sampler.height(ox, oz);
          const rotY = rng() * Math.PI * 2;
          // Real footprints already place buildings correctly — skip generic
          // building models for urban roads that have them. Everywhere else
          // (rural roads, AND urban roads whose real buildings are drawn
          // separately by RealBuildings) gets street trees instead — a real
          // building-lined road still has trees along it; this used to place
          // nothing at all in the urban+real-footprint case.
          if (urban && !hasRealBuildings) {
            // Kenney's commercial building models read small next to a real-scale
            // car/road — bumped up further as a deliberate visual-scale choice.
            bldgSpecs.push({ pos: [ox, oy, oz], rotY, scale: 3.5 + rng() * 4.5, model: Math.floor(rng() * BUILDING_MODELS.length) });
          } else {
            if (hasRealBuildings && insideAnyBuilding(ox, oz)) continue;
            // Roadside clutter reading as "all identical trees in a row" felt
            // artificial — a real verge mixes in the odd boulder among the
            // trees, especially on rural/hilly roads.
            if (!urban && rng() < 0.18) {
              rockSpecs.push({ pos: [ox, oy, oz], rotY, scale: 0.6 + rng() * 1.3, geom: Math.floor(rng() * ROCK_GEOMETRIES.length) });
            } else {
              // Wide, uniform-random range rather than a narrow band around one
              // "normal tree" size — real treelines mix saplings, ordinary
              // trees, and the odd old-growth giant that reads as tall as a
              // small building next to the road, not a uniform hedge.
              treeSpecs.push({ pos: [ox, oy, oz], rotY, scale: 1.6 + rng() * 5.4, model: Math.floor(rng() * TREE_MODELS.length) });
            }
          }
        }
      }
    }

    // Front row: tight spacing, high odds, close to the shoulder.
    placeRow(urban ? 6 : 8, urban ? 0.88 : 0.8, urban ? 6 : 4, urban ? 5 : 10, halfWidth + 8);
    // Back row: wider spacing, lower odds (avoids a uniform wall), set well
    // back so it reads as a second depth layer rather than doubling the front row.
    placeRow(urban ? 11 : 15, urban ? 0.6 : 0.5, urban ? 14 : 18, urban ? 10 : 16, halfWidth + 8);

    // Both rows above stay within a fairly thin band of the road (halfWidth +
    // up to ~34m) — everywhere past that, out to the actual edge of Terrain's
    // ground plane, was bare textured ground with nothing on it at all. This
    // scatters sparse bushes/rocks across the FULL terrain footprint instead,
    // so the whole visible patch of ground has something on it, not just a
    // roadside fringe with an empty field beyond it.
    const halfX = sizeX / 2, halfZ = sizeZ / 2;
    const farStep = 20;
    for (let fx = -halfX; fx < halfX; fx += farStep) {
      for (let fz = -halfZ; fz < halfZ; fz += farStep) {
        if (rng() > 0.28) continue;
        const ox = bounds.centerX + fx + (rng() - 0.5) * farStep;
        const oz = bounds.centerZ + fz + (rng() - 0.5) * farStep;
        if (!clearOfRoad(ox, oz, halfWidth + 8)) continue;
        if (hasRealBuildings && insideAnyBuilding(ox, oz)) continue;
        const oy = sampler.height(ox, oz);
        const rotY = rng() * Math.PI * 2;
        if (rng() < 0.35) {
          rockSpecs.push({ pos: [ox, oy, oz], rotY, scale: 0.5 + rng() * 1.4, geom: Math.floor(rng() * ROCK_GEOMETRIES.length) });
        } else {
          // Still random-sized (small bush up to another building-scale
          // giant), just a lower ceiling on average than the roadside rows
          // so the middle distance reads as a depth layer, not a duplicate
          // front row.
          treeSpecs.push({ pos: [ox, oy, oz], rotY, scale: 0.8 + rng() * 3.6, model: Math.floor(rng() * TREE_MODELS.length) });
        }
      }
    }

    return { trees: treeSpecs, buildings: bldgSpecs, rocks: rockSpecs };
  }, [points, halfWidth, rng, urban, road.cliff_scenario, hasRealBuildings, sampler, bounds, sizeX, sizeZ]);

  return (
    <group>
      <Merged meshes={treeMeshes} castShadow limit={1500}>
        {(instances: Record<string, React.ComponentType<any>>) => (
          <>
            {trees.map((t, i) => (
              <group key={i} position={t.pos} rotation={[0, t.rotY, 0]} scale={t.scale}>
                {treePartsByModel[t.model]?.map((key) => {
                  const TreePart = instances[key];
                  return <TreePart key={key} />;
                })}
              </group>
            ))}
          </>
        )}
      </Merged>
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
      <Merged meshes={rockMeshes} castShadow receiveShadow limit={1000}>
        {(instances: Record<string, React.ComponentType<any>>) => (
          <>
            {rocks.map((r, i) => {
              const RockPart = instances[`r${r.geom}`];
              return <RockPart key={i} position={r.pos} rotation={[0, r.rotY, 0]} scale={r.scale} />;
            })}
          </>
        )}
      </Merged>
    </group>
  );
}

useGLTF.preload(TREE_MODELS);
useGLTF.preload(BUILDING_MODELS);
