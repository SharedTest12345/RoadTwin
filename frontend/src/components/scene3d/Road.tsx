import { useMemo } from "react";
import * as THREE from "three";
import type { Road as RoadT } from "../../types";
import { buildPath, toWorld, perpendicular, riskColor } from "../../three/geometryUtils";
import { asphaltTexture } from "../../three/textures";

function ribbonGeometry(points: ReturnType<typeof buildPath>, halfWidth: number, yOffset: number) {
  const geom = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const [px, pz] = perpendicular(p.ribbonHeading);
    const [wx, wy, wz] = toWorld(p.x, p.y, p.elev + yOffset);
    positions.push(wx - px * halfWidth, wy, wz - pz * halfWidth);
    positions.push(wx + px * halfWidth, wy, wz + pz * halfWidth);
    uvs.push(0, p.s / 4, 1, p.s / 4);
  }
  const indices: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

function stripGeometry(points: ReturnType<typeof buildPath>, offsetFrac: number, halfWidth: number, yOffset: number) {
  const geom = new THREE.BufferGeometry();
  const positions: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const [px, pz] = perpendicular(p.ribbonHeading);
    const [wx, wy, wz] = toWorld(p.x, p.y, p.elev + yOffset);
    const cx = wx + px * offsetFrac, cz = wz + pz * offsetFrac;
    positions.push(cx - px * halfWidth, wy, cz - pz * halfWidth);
    positions.push(cx + px * halfWidth, wy, cz + pz * halfWidth);
  }
  const indices: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

export function Road({ road }: { road: RoadT }) {
  const points = useMemo(() => buildPath(road), [road]);
  const halfWidth = Math.max(2, road.features.lanes) * 1.7;

  const surfaceGeom = useMemo(() => ribbonGeometry(points, halfWidth, 0), [points, halfWidth]);
  const centerGeom = useMemo(() => stripGeometry(points, 0, 0.11, 0.025), [points]);
  const riskEdgeGeom = useMemo(() => stripGeometry(points, halfWidth - 0.15, 0.18, 0.03), [points, halfWidth]);
  const farEdgeGeom = useMemo(() => stripGeometry(points, -(halfWidth - 0.15), 0.1, 0.03), [points, halfWidth]);
  const sidewalkGeom = useMemo(
    () => (road.features.has_sidewalk ? stripGeometry(points, halfWidth + 0.9, 0.8, 0.08) : null),
    [points, halfWidth, road.features.has_sidewalk]
  );

  const color = riskColor(road.risk.category);
  const asphalt = useMemo(() => {
    const t = asphaltTexture();
    t.repeat.set(1, Math.max(1, road.geometry.length_m / 10));
    return t;
  }, [road.id, road.geometry.length_m]);

  return (
    <group>
      {/* DoubleSide on every road strip: a sharp real-world hairpin (a near-180°
          reversal packed into a single OSRM-derived segment, unlike the demo
          catalog's switchbacks which spread the same turn over many gentler
          vertices) can flip this ribbon-strip triangulation's winding order for
          that one segment. Default front-side-only materials made that stretch
          backface-culled — geometrically present but invisible from the normal
          top-down chase camera, reading as the road vanishing mid-path. */}
      <mesh geometry={surfaceGeom} receiveShadow>
        <meshStandardMaterial map={asphalt} roughness={0.95} metalness={0.05} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={centerGeom}>
        <meshStandardMaterial color="#f2f5f9" emissive="#f2f5f9" emissiveIntensity={0.4} transparent opacity={0.92} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={farEdgeGeom}>
        <meshStandardMaterial color="#dde2e8" emissive="#dde2e8" emissiveIntensity={0.2} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={riskEdgeGeom}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.3} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {sidewalkGeom && (
        <mesh geometry={sidewalkGeom}>
          <meshStandardMaterial color="#8a8f96" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
