import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Road } from "../../types";
import { buildPath, toWorld, perpendicular } from "../../three/geometryUtils";
import { groundTexture } from "../../three/textures";
import { createTerrainHeightSampler, terrainSeedFor } from "../../three/terrainHeight";

// Low valley / mid slope / high ridge tints, blended per-vertex by height. These
// MULTIPLY the ground texture (vertexColors + map), so they have to sit near white
// — the previous near-black values (#161c29 etc.) were scaling the ground texture
// down to ~8% brightness, which is most of why the terrain read as a black void
// no matter what the noise/lighting did. Greener low ground, sun-bleached ridges.
const VALLEY_COLOR = new THREE.Color("#a8b98c");
const SLOPE_COLOR = new THREE.Color("#ffffff");
const RIDGE_COLOR = new THREE.Color("#d9d2b6");

export function Terrain({ road }: { road: Road }) {
  const points = useMemo(() => buildPath(road), [road]);
  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of points) {
      const [wx, , wz] = toWorld(p.x, p.y, 0);
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
      minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
    }
    return { minX, maxX, minZ, maxZ };
  }, [points]);

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  // Big enough that the edge is always past the fog's far distance (see Scene.tsx) —
  // a visible flat-plane silhouette floating in the black void was the single
  // worst "this looks fake" tell in the whole scene.
  const sizeX = Math.max(bounds.maxX - bounds.minX + 3200, 3400);
  const sizeZ = Math.max(bounds.maxZ - bounds.minZ + 3200, 3400);

  const isHilly = road.features.slope_pct > 5;
  const halfWidth = Math.max(2, road.features.lanes) * 1.7;

  // Single ground-truth height function shared by the terrain mesh below and (via
  // the road's own per-point elevation, which this sampler blends toward near the
  // corridor) the road ribbon and edge props — see terrainHeight.ts. Replaces a
  // flat base plane with independent ripple noise, which sat at one constant
  // offset regardless of how much the road itself climbed or dropped.
  const sampler = useMemo(
    () => createTerrainHeightSampler(points, halfWidth, isHilly, terrainSeedFor(road.id, points.length)),
    [points, halfWidth, isHilly, road.id]
  );

  const groundGeom = useMemo(() => {
    const segs = 256;
    const geom = new THREE.PlaneGeometry(sizeX, sizeZ, segs, segs);
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const heights = new Float32Array(pos.count);
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const wx = centerX + pos.getX(i), wz = centerZ - pos.getY(i);
      const h = sampler.height(wx, wz);
      heights[i] = h;
      pos.setZ(i, h);
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
    const colors = new Float32Array(pos.count * 3);
    const range = Math.max(1e-6, maxH - minH);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = (heights[i] - minH) / range;
      c.copy(VALLEY_COLOR).lerp(SLOPE_COLOR, Math.min(1, t * 2));
      if (t > 0.5) c.lerp(RIDGE_COLOR, (t - 0.5) * 2);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geom.computeVertexNormals();
    return geom;
  }, [sizeX, sizeZ, centerX, centerZ, sampler]);

  const tex = useMemo(() => groundTexture(isHilly), [isHilly]);
  tex.repeat.set(sizeX / 14, sizeZ / 14); // keep texel density roughly constant across road sizes

  const waterRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (waterRef.current?.map) {
      waterRef.current.map.offset.set(Math.sin(clock.elapsedTime * 0.04) * 0.05, clock.elapsedTime * 0.015);
    }
  });
  const waterTex = useMemo(() => {
    const t = groundTexture(false);
    t.repeat.set(10, 10);
    return t;
  }, []);
  const minElev = useMemo(() => Math.min(0, ...points.map((p) => p.elev)), [points]);
  const waterY = minElev - 3;

  const cliffEdgeGeom = useMemo(() => {
    if (!road.cliff_scenario) return null;
    // A visible ~3.5m dirt shoulder sits between the road edge and the drop, so the
    // cliff face reads as a distinct hillside rather than merging with the road
    // ribbon at a glance (it previously started right at the road edge).
    const shoulder = 3.5;
    const positions: number[] = [];
    const uvs: number[] = [];
    for (const p of points) {
      const [px, pz] = perpendicular(p.ribbonHeading);
      const [wx, wy, wz] = toWorld(p.x, p.y, p.elev);
      const ex = wx - px * (halfWidth + shoulder), ez = wz - pz * (halfWidth + shoulder);
      positions.push(ex, wy - 0.3, ez);
      positions.push(ex - px * 12, wy - 11, ez - pz * 12);
      uvs.push(0, p.s / 6, 1, p.s / 6);
    }
    const geom = new THREE.BufferGeometry();
    const idx: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, c, b, b, c, d);
    }
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(idx);
    geom.computeVertexNormals();
    return geom;
  }, [points, road]);

  const cliffTex = useMemo(() => {
    const t = groundTexture(true);
    t.repeat.set(2, Math.max(1, road.geometry.length_m / 15));
    return t;
  }, [road.geometry.length_m]);

  return (
    <group>
      <mesh geometry={groundGeom} position={[centerX, 0, centerZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial map={tex} vertexColors roughness={1} />
      </mesh>

      {road.features.near_water && (
        <mesh position={[centerX, waterY, centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[sizeX * 0.55, sizeZ * 0.55, 1, 1]} />
          <meshStandardMaterial
            ref={waterRef}
            map={waterTex}
            color="#3f7fa6"
            // metalness has to stay ~0 here: there is no environment map in the
            // scene (the night HDRI was removed with the daylight conversion), and
            // a metallic surface with nothing to reflect renders as a flat gray
            // sheet — which is exactly how the lake was reading.
            roughness={0.22}
            metalness={0}
            transparent
            opacity={0.8}
          />
        </mesh>
      )}

      {cliffEdgeGeom && (
        // Exposed rock face — deliberately a different material read from the
        // grassy ground above it, so the drop-off reads as a genuine hazard edge
        // rather than the hillside simply continuing over the side.
        <mesh geometry={cliffEdgeGeom} receiveShadow>
          <meshStandardMaterial map={cliffTex} color="#9d9382" roughness={1} metalness={0} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
