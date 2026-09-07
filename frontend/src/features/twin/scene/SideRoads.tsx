import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Road, SideRoad } from "../../../types";
import { buildPath, toWorld, roadHalfWidth } from "../../../three/geometryUtils";
import { asphaltTexture } from "../../../three/textures";
import { createTerrainHeightSampler, terrainSeedFor } from "../../../three/terrainHeight";

// Real incoming/side streets, trimmed to a short stub centered on their real
// junction point with this road (see feature_extraction.py's
// _extract_side_roads) — VISUAL ONLY. Vehicles never turn onto/from these;
// the traffic simulation still runs entirely along the main road's own path.
// A narrower carriageway than the main road (most real side streets are).
const SIDE_ROAD_HALF_WIDTH_M = 3.2;
const SIGNAL_POLE_HEIGHT_M = 4.2;
const SIGNAL_BULB_RADIUS_M = 0.32;
const SIGNAL_CYCLE_S = 30;
const SIGNAL_GREEN_S = 18;

/** Simple quad-strip through `worldPts`, perpendicular offset in the world
 * XZ plane from each point's own local forward direction — self-contained
 * (doesn't need to match the main road's toWorld/heading conventions, since
 * this stub isn't interacted with by any other system). */
function buildStubGeometry(worldPts: THREE.Vector3[], halfWidth: number): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  let cum = 0;
  for (let i = 0; i < worldPts.length; i++) {
    if (i > 0) cum += worldPts[i].distanceTo(worldPts[i - 1]);
    const a = worldPts[Math.max(0, i - 1)];
    const b = worldPts[Math.min(worldPts.length - 1, i + 1)];
    const heading = Math.atan2(b.z - a.z, b.x - a.x);
    const px = -Math.sin(heading), pz = Math.cos(heading);
    const p = worldPts[i];
    positions.push(p.x - px * halfWidth, p.y, p.z - pz * halfWidth);
    positions.push(p.x + px * halfWidth, p.y, p.z + pz * halfWidth);
    uvs.push(0, cum / 6, 1, cum / 6);
  }
  const indices: number[] = [];
  for (let i = 0; i < worldPts.length - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

function SideRoadStub({ sideRoad, groundHeight, phaseOffset }: {
  sideRoad: SideRoad; groundHeight: (wx: number, wz: number) => number; phaseOffset: number;
}) {
  const worldPts = useMemo(
    () => sideRoad.points_xy.map(([x, y]) => {
      const [wx, , wz] = toWorld(x, y, 0);
      return new THREE.Vector3(wx, groundHeight(wx, wz), wz);
    }),
    [sideRoad, groundHeight]
  );
  const geom = useMemo(() => buildStubGeometry(worldPts, SIDE_ROAD_HALF_WIDTH_M), [worldPts]);
  const tex = useMemo(() => {
    const t = asphaltTexture();
    t.repeat.set(1, Math.max(1, worldPts.length / 3));
    return t;
  }, [worldPts.length]);

  const junction = worldPts[Math.min(sideRoad.junction_index, worldPts.length - 1)];
  // Face the pole out along the stub's own direction at the junction, offset
  // to one side like a real signal standing at the corner rather than in the
  // carriageway.
  const jPrev = worldPts[Math.max(0, sideRoad.junction_index - 1)];
  const jNext = worldPts[Math.min(worldPts.length - 1, sideRoad.junction_index + 1)];
  const dir = new THREE.Vector3().subVectors(jNext, jPrev);
  const sideOffset = dir.lengthSq() > 1e-6
    ? new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(SIDE_ROAD_HALF_WIDTH_M + 1.4)
    : new THREE.Vector3(SIDE_ROAD_HALF_WIDTH_M + 1.4, 0, 0);
  const polePos = junction.clone().add(sideOffset);

  const bulbRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const mesh = bulbRef.current;
    if (!mesh) return;
    const phase = (clock.elapsedTime + phaseOffset) % SIGNAL_CYCLE_S;
    const red = phase > SIGNAL_GREEN_S;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.color.set(red ? "#ef4444" : "#22c55e");
    mat.emissive.set(red ? "#ef4444" : "#22c55e");
  });

  return (
    <group>
      <mesh geometry={geom} receiveShadow>
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
      <group position={polePos}>
        <mesh position={[0, SIGNAL_POLE_HEIGHT_M / 2, 0]}>
          <cylinderGeometry args={[0.09, 0.09, SIGNAL_POLE_HEIGHT_M, 6]} />
          <meshStandardMaterial color="#33383f" />
        </mesh>
        <mesh ref={bulbRef} position={[0, SIGNAL_POLE_HEIGHT_M + 0.1, 0]}>
          <sphereGeometry args={[SIGNAL_BULB_RADIUS_M, 10, 10]} />
          <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={4} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

export function SideRoads({ road }: { road: Road }) {
  const points = useMemo(() => buildPath(road), [road]);
  const halfWidth = roadHalfWidth(road);
  const isHilly = road.features.slope_pct > 5;
  // Same ground-truth sampler Terrain.tsx/Scenery.tsx/WeatherEffects.tsx build
  // (identical seed via terrainSeedFor) — a stub's own points need to land on
  // the SAME ground everything else in the scene sits on, not a separately
  // rolled noise field.
  const sampler = useMemo(
    () => createTerrainHeightSampler(points, halfWidth, isHilly, terrainSeedFor(road.id, points.length)),
    [points, halfWidth, isHilly, road.id]
  );

  const sideRoads = road.geometry.side_roads;
  if (sideRoads.length === 0) return null;

  return (
    <group>
      {sideRoads.map((sr, i) => (
        <SideRoadStub key={i} sideRoad={sr} groundHeight={sampler.height} phaseOffset={i * 7.3} />
      ))}
    </group>
  );
}
