import { useMemo } from "react";
import * as THREE from "three";
import type { Road as RoadT } from "../../../types";
import { buildPath, roadHalfWidth, catmullRomThrough } from "../../../three/geometryUtils";
import { asphaltTexture } from "../../../three/textures";
import { EMBANKMENT_DROP, SHOULDER_WIDTH } from "../../../three/terrainHeight";
import { useStore } from "../../../state/store";

const UP = new THREE.Vector3(0, 1, 0);
// Roughly one sample per 3m of real road length — routes can now run up to
// 2000m (raised from an old 500m cap), so a fixed sample count sized for the
// old short-route era badly under-sampled a long route. Floored so a short
// demo road still gets a smooth curve, capped so an extreme-length route
// doesn't generate an unreasonable vertex count.
const SAMPLES_PER_METER = 1 / 3;
const MIN_CURVE_SAMPLES = 60;
const MAX_CURVE_SAMPLES = 1200;

interface CurveSample {
  t: number;
  point: THREE.Vector3;
  binormal: THREE.Vector3;
}

function sampleCurve(curve: THREE.CatmullRomCurve3, curveLength: number): CurveSample[] {
  const sampleCount = Math.min(
    MAX_CURVE_SAMPLES,
    Math.max(MIN_CURVE_SAMPLES, Math.round(curveLength * SAMPLES_PER_METER))
  );
  const out: CurveSample[] = [];
  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    // getPointAt/getTangentAt (NOT getPoint/getTangent) — Three.js's `t` for a
    // CatmullRomCurve3 is uniform in PARAMETER space, which for real, unevenly-
    // curving road data is NOT the same as uniform along actual arc length. A
    // sharp real turn concentrated in a short arc-length span can end up
    // under-sampled relative to the long straight stretches around it, which
    // read as the road surface (and the dashed center line, whose dash timing
    // also assumed t*curveLength was real distance) visibly pinching/twisting
    // right at that corner. The *At variants use Three.js's own arc-length
    // lookup table, so `t` genuinely means "this fraction of the real distance
    // along the road" everywhere, sharp turns included.
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, UP).normalize();
    out.push({ t, point, binormal });
  }
  return out;
}

function quadStrip(samples: CurveSample[], halfWidth: number, yOffset: number, uvScale: number) {
  const geom = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const s of samples) {
    const left = s.point.clone().addScaledVector(s.binormal, -halfWidth);
    const right = s.point.clone().addScaledVector(s.binormal, halfWidth);
    positions.push(left.x, left.y + yOffset, left.z, right.x, right.y + yOffset, right.z);
    uvs.push(0, s.t * uvScale, 1, s.t * uvScale);
  }
  const indices: number[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/** A strip at an arbitrary lateral offset from the curve — the centerline,
 * lane boundaries, or an edge line all use this at different offsets. */
function offsetStrip(samples: CurveSample[], offset: number, halfWidth: number, yOffset: number) {
  const geom = new THREE.BufferGeometry();
  const positions: number[] = [];
  for (const s of samples) {
    const center = s.point.clone().addScaledVector(s.binormal, offset);
    const left = center.clone().addScaledVector(s.binormal, -halfWidth);
    const right = center.clone().addScaledVector(s.binormal, halfWidth);
    positions.push(left.x, left.y + yOffset, left.z, right.x, right.y + yOffset, right.z);
  }
  const indices: number[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/** Dashed variant of offsetStrip — real arc length (curve.getLength()) drives
 * the dash/gap period, same as the reference engine's tStart/tEnd-by-distance
 * approach, so dash size stays constant in meters regardless of road length. */
function dashedOffsetStrip(
  samples: CurveSample[], curveLength: number, offset: number, halfWidth: number, yOffset: number,
  dashLen: number, gapLen: number
) {
  const geom = new THREE.BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];
  const period = dashLen + gapLen;
  let vi = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const distAlong = samples[i].t * curveLength;
    if (distAlong % period >= dashLen) continue;
    const a = samples[i], b = samples[i + 1];
    const aCenter = a.point.clone().addScaledVector(a.binormal, offset);
    const bCenter = b.point.clone().addScaledVector(b.binormal, offset);
    const aL = aCenter.clone().addScaledVector(a.binormal, -halfWidth);
    const aR = aCenter.clone().addScaledVector(a.binormal, halfWidth);
    const bL = bCenter.clone().addScaledVector(b.binormal, -halfWidth);
    const bR = bCenter.clone().addScaledVector(b.binormal, halfWidth);
    positions.push(aL.x, aL.y + yOffset, aL.z, aR.x, aR.y + yOffset, aR.z);
    positions.push(bL.x, bL.y + yOffset, bL.z, bR.x, bR.y + yOffset, bR.z);
    indices.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
    vi += 4;
  }
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/** The embankment slope from the carriageway edge down to the surrounding
 * ground — necessary because (unlike a flat mock terrain plane) this scene's
 * real terrain rolls with real elevation, so the shoulder has to actually
 * meet it rather than assume a fixed height offset. */
function shoulderStrip(samples: CurveSample[], halfWidth: number, side: 1 | -1) {
  const geom = new THREE.BufferGeometry();
  const positions: number[] = [];
  for (const s of samples) {
    const inner = s.point.clone().addScaledVector(s.binormal, halfWidth * side);
    const outer = s.point.clone().addScaledVector(s.binormal, (halfWidth + SHOULDER_WIDTH) * side);
    positions.push(inner.x, inner.y, inner.z, outer.x, outer.y - EMBANKMENT_DROP, outer.z);
  }
  const indices: number[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/** A short raised lip between the carriageway edge and the sidewalk — only
 * where `features.has_sidewalk` is true. */
function curbStrip(samples: CurveSample[], halfWidth: number) {
  const CURB_WIDTH = 0.22, CURB_HEIGHT = 0.14;
  const geom = new THREE.BufferGeometry();
  const positions: number[] = [];
  for (const s of samples) {
    const inner = s.point.clone().addScaledVector(s.binormal, halfWidth);
    const outer = s.point.clone().addScaledVector(s.binormal, halfWidth + CURB_WIDTH);
    positions.push(inner.x, inner.y, inner.z, outer.x, outer.y + CURB_HEIGHT, outer.z);
  }
  const indices: number[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

// US MUTCD-standard marking colors.
const MARKING_WHITE = "#f8fafc";
const MARKING_YELLOW = "#f59e0b";
const DASH_LEN = 3.5, GAP_LEN = 7.0;

/** MUTCD-style lane markings driven by the road's real lane count/oneway
 * tag: solid white edge lines always; a yellow center line where opposing
 * traffic actually shares the carriageway (2-way roads); white dashed
 * boundaries at every other internal lane line. A one-way multi-lane road
 * gets no yellow — every lane shares one direction of travel. */
function laneMarkings(samples: CurveSample[], curveLength: number, halfWidth: number, lanes: number, oneway: boolean) {
  if (lanes <= 1) return [];
  const laneWidth = (halfWidth * 2) / lanes;
  const centerBoundary = Math.floor(lanes / 2);
  const out: { geom: THREE.BufferGeometry; color: string; solid: boolean }[] = [];
  for (let k = 1; k < lanes; k++) {
    const offset = -halfWidth + laneWidth * k;
    if (!oneway && k === centerBoundary) {
      out.push({ geom: offsetStrip(samples, offset, 0.12, 0.025), color: MARKING_YELLOW, solid: true });
    } else {
      out.push({ geom: dashedOffsetStrip(samples, curveLength, offset, 0.09, 0.025, DASH_LEN, GAP_LEN), color: MARKING_WHITE, solid: false });
    }
  }
  return out;
}

export function Road({ road, sidewalkActive }: { road: RoadT; sidewalkActive: boolean }) {
  const points = useMemo(() => buildPath(road), [road]);
  const curve = useMemo(() => catmullRomThrough(points), [points]);
  const curveLength = useMemo(() => curve.getLength(), [curve]);
  const samples = useMemo(() => sampleCurve(curve, curveLength), [curve, curveLength]);
  const halfWidth = roadHalfWidth(road);
  const lanes = road.features.lanes;
  const oneway = road.tags.oneway;

  const surfaceGeom = useMemo(() => quadStrip(samples, halfWidth, 0, 25), [samples, halfWidth]);
  const markings = useMemo(
    () => laneMarkings(samples, curveLength, halfWidth, lanes, oneway),
    [samples, curveLength, halfWidth, lanes, oneway]
  );
  const leftEdgeGeom = useMemo(() => offsetStrip(samples, halfWidth - 0.15, 0.14, 0.03), [samples, halfWidth]);
  const rightEdgeGeom = useMemo(() => offsetStrip(samples, -(halfWidth - 0.15), 0.14, 0.03), [samples, halfWidth]);
  // Was gated on the road's static has_sidewalk feature alone, so toggling
  // the "Add Sidewalk" intervention (which only ever sets the combined
  // sidewalkActive override, not the static feature) had no visible effect —
  // this now reacts to the same combined flag Infrastructure.tsx receives.
  const sidewalkGeom = useMemo(
    () => (sidewalkActive ? offsetStrip(samples, halfWidth + 0.9, 0.8, 0.08) : null),
    [samples, halfWidth, sidewalkActive]
  );
  const curbGeom = useMemo(
    () => (sidewalkActive ? curbStrip(samples, halfWidth) : null),
    [samples, halfWidth, sidewalkActive]
  );
  const shoulderLeft = useMemo(() => shoulderStrip(samples, halfWidth, -1), [samples, halfWidth]);
  const shoulderRight = useMemo(() => shoulderStrip(samples, halfWidth, 1), [samples, halfWidth]);

  const asphalt = useMemo(() => {
    const t = asphaltTexture();
    t.repeat.set(1, Math.max(1, road.geometry.length_m / 10));
    return t;
  }, [road.id, road.geometry.length_m]);

  // Wet-road look for the rain preset — lower roughness/higher metalness so
  // it picks up specular highlights the way an actual rain-slicked road
  // does, matching the reference engine's asphaltMaterial wetness update.
  const isWet = useStore((s) => s.weatherPreset === "rain");
  const asphaltRoughness = isWet ? 0.22 : 0.85;
  const asphaltMetalness = isWet ? 0.28 : 0.08;

  return (
    <group>
      {/* DoubleSide on every strip: a sharp real-world hairpin (a near-180°
          reversal packed into a single OSRM-derived segment) can flip the
          local winding order for that one segment; front-side-only materials
          made that stretch backface-culled. */}
      {[shoulderLeft, shoulderRight].map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow castShadow>
          <meshStandardMaterial color="#3d434d" roughness={0.95} metalness={0.05} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <mesh geometry={surfaceGeom} receiveShadow>
        <meshStandardMaterial map={asphalt} color="#2e333d" roughness={asphaltRoughness} metalness={asphaltMetalness} side={THREE.DoubleSide} />
      </mesh>
      {markings.map((m, i) => (
        <mesh key={i} geometry={m.geom}>
          <meshStandardMaterial
            color={m.color} emissive={m.color} emissiveIntensity={0.15}
            transparent={!m.solid} opacity={m.solid ? 1 : 0.95} side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      <mesh geometry={leftEdgeGeom}>
        <meshStandardMaterial color={MARKING_WHITE} emissive={MARKING_WHITE} emissiveIntensity={0.15} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={rightEdgeGeom}>
        <meshStandardMaterial color={MARKING_WHITE} emissive={MARKING_WHITE} emissiveIntensity={0.15} side={THREE.DoubleSide} />
      </mesh>
      {curbGeom && (
        <mesh geometry={curbGeom} castShadow receiveShadow>
          <meshStandardMaterial color="#9a9d9f" roughness={0.85} side={THREE.DoubleSide} />
        </mesh>
      )}
      {sidewalkGeom && (
        <mesh geometry={sidewalkGeom}>
          <meshStandardMaterial color="#8a8f96" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
