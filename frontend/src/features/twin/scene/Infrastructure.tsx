import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useGLTF, Clone } from "@react-three/drei";
import * as THREE from "three";
import type { Road } from "../../../types";
import { buildPath, toWorld, perpendicular, sampleAlongPath, roadHalfWidth, buildRoadCurve, sampleRoadCurveAt } from "../../../three/geometryUtils";
import { shoulderDrop } from "../../../three/terrainHeight";
import { STREETLIGHT_MODEL, GUARDRAIL_MODEL, WARNING_SIGN_MODEL, STOP_SIGN_MODEL, CONE_MODEL } from "../../../three/propModels";
import { crossingTexture, speedBumpTexture } from "../../../three/textures";

interface Props {
  road: Road;
  guardrailActive: boolean;
  lightingActive: boolean;
  sidewalkActive: boolean;
  crossingActive: boolean;
  signalActive: boolean;
  speedBumpsActive: boolean;
}

// Real Kenney models (~1 unit = 1m) rather than procedural rails/cylinders/octahedra.
const GUARDRAIL_SCALE = 4.5;
// light-curved.glb's own bounding box (verified directly from its accessor
// min/max) is only ~0.675 units tall — the model is authored at a much
// smaller intrinsic scale than "1 unit = 1m". 1.3 rendered a knee-high stub,
// and the glow/bulb below was hand-placed at y=6.2 assuming a ~6m pole —
// entirely disconnected from where the actual (tiny) model ended, which is
// exactly the "floating sphere" bug. 10.5 brings the pole to a real ~7m
// streetlight height; the bulb offset below is recomputed to match.
const STREETLIGHT_SCALE = 10.5;
const STREETLIGHT_UNSCALED_HEIGHT = 0.675;
const STREETLIGHT_UNSCALED_ARM = 0.2; // how far the curved arm extends in local -Z
const WARNING_SIGN_SCALE = 1.1;
const STOP_SIGN_SCALE = 1.1;
const CONE_SCALE = 6;
// fenceStraight's long axis is local +X (verified via its own bounding box:
// X extent 1.0 vs Y 0.5 vs Z 0.035), not +Z like the road/vehicle convention.
// The correct rotation for a +X-forward object using this codebase's own
// world-plane heading convention is -heading with NO extra offset (matches
// Infrastructure's other +X-forward-style placements below) — the previous
// extra +90deg here rotated each segment's long axis to point ACROSS the
// road instead of along it, which is what actually read as "not oriented
// properly with the road" (crooked/perpendicular fence segments).
const GUARDRAIL_ROT_OFFSET = 0;
// Road.tsx's own white edge line sits at halfWidth-0.15 from centerline (see
// its leftEdgeGeom/rightEdgeGeom) — guardrails now sit exactly on that same
// line instead of an unrelated +0.3 pad past the carriageway edge, which is
// what read as "not lined up with the road's own edge." Lamps sit a bit
// further out again (past the guardrail, not past the white line by only a
// hair) so their base doesn't overlap the rail.
const EDGE_LINE_OFFSET_M = -0.15; // matches Road.tsx's halfWidth - 0.15 exactly
const LAMP_EDGE_DEVIATION_M = 1.2; // extra distance beyond the white line, away from center
const SPEED_BUMP_HEIGHT = 0.12;
const SPEED_BUMP_THICKNESS = 0.6; // along-road
const SPEED_BUMP_SPACING_M = 40; // typical real speed-hump spacing on a traffic-calmed street

export function Infrastructure({ road, guardrailActive, lightingActive, sidewalkActive, crossingActive, signalActive, speedBumpsActive }: Props) {
  const points = useMemo(() => buildPath(road), [road]);
  const halfWidth = roadHalfWidth(road);
  // The SAME curve Road.tsx renders its asphalt/edge-lines from — sampling
  // this (not buildPath's raw points directly) is what guarantees the
  // guardrail/lamp actually land on the rendered white line rather than a
  // separately-computed, slightly different curve through the same points.
  const { curve: roadCurve, length: roadCurveLength } = useMemo(() => buildRoadCurve(road), [road]);

  const guardrailGltf = useGLTF(GUARDRAIL_MODEL);
  const streetlightGltf = useGLTF(STREETLIGHT_MODEL);
  const warningGltf = useGLTF(WARNING_SIGN_MODEL);
  const stopSignGltf = useGLTF(STOP_SIGN_MODEL);
  const coneGltf = useGLTF(CONE_MODEL);

  // fenceStraight.gltf was exported from a larger scene without re-baking to
  // origin: its one root node carries a translation offset, so cloning
  // guardrailGltf.scene directly placed the mesh away from where <Clone
  // position={...}> put the group.
  const guardrailScene = useMemo(() => {
    const scene = guardrailGltf.scene.clone(true);
    scene.children.forEach((child) => child.position.set(0, 0, 0));
    return scene;
  }, [guardrailGltf]);

  const guardrailPlacements = useMemo(() => {
    if (!guardrailActive || roadCurveLength < 1e-6) return [];
    const out: { pos: THREE.Vector3; rotY: number }[] = [];
    const segmentLen = GUARDRAIL_SCALE; // fenceStraight is 1 unit long before scale
    const edgeDist = halfWidth + EDGE_LINE_OFFSET_M;
    // Both edges — Road.tsx's leftEdgeGeom (+edgeDist along binormal) and
    // rightEdgeGeom (-edgeDist along binormal) are the exact two lines this
    // now targets, sampling the SAME curve object those lines are drawn from
    // instead of buildPath's raw points + a separately-computed 2D bisector,
    // which is what let the rail's distance match the line's distance in
    // NUMBER while still not actually landing on the line's real position.
    for (let s = 0; s < roadCurveLength; s += segmentLen) {
      const cp = sampleRoadCurveAt(roadCurve, roadCurveLength, s);
      for (const side of [1, -1] as const) {
        out.push({
          pos: cp.point.clone().addScaledVector(cp.binormal, edgeDist * side),
          rotY: -cp.heading + GUARDRAIL_ROT_OFFSET,
        });
      }
    }
    return out;
  }, [roadCurve, roadCurveLength, halfWidth, guardrailActive]);

  const speedBumpPlacements = useMemo(() => {
    if (!speedBumpsActive || points.length < 2) return [];
    const out: { pos: THREE.Vector3; rotY: number }[] = [];
    const total = points[points.length - 1].s;
    for (let s = SPEED_BUMP_SPACING_M; s < total; s += SPEED_BUMP_SPACING_M) {
      const p = sampleAlongPath(points, s);
      const [wx, wy, wz] = toWorld(p.x, p.y, p.elev);
      // Same -heading rotation used for the fence's long axis (see
      // GUARDRAIL_ROT_OFFSET above) — here aligning the box's THIN local-X
      // dimension with the road tangent, so its wide local-Z dimension spans
      // the full carriageway width automatically.
      out.push({ pos: new THREE.Vector3(wx, wy + SPEED_BUMP_HEIGHT / 2, wz), rotY: -p.heading });
    }
    return out;
  }, [points, speedBumpsActive]);

  const speedBumpTex = useMemo(() => {
    const t = speedBumpTexture();
    t.repeat.set(1, (halfWidth * 2) / 1.0);
    return t;
  }, [halfWidth]);

  const lampPositions = useMemo(() => {
    if (!lightingActive || roadCurveLength < 1e-6) return [];
    const out: { pos: THREE.Vector3; rotY: number }[] = [];
    const spacing = 25; // typical real streetlight spacing, in meters
    // Anchored to the same curve/binormal the guardrail (and Road.tsx's own
    // edge lines) now use, so the pole base's distance from the line is
    // measured off the actual rendered line, not a separately-tracked curve.
    const edgeDist = halfWidth + EDGE_LINE_OFFSET_M + LAMP_EDGE_DEVIATION_M;
    for (let s = 0; s < roadCurveLength; s += spacing) {
      const cp = sampleRoadCurveAt(roadCurve, roadCurveLength, s);
      // Roadside props stand on the embankment slope / ground beside the road,
      // not at carriageway height.
      const y = cp.point.y - shoulderDrop(2.5);
      for (const side of [1, -1] as const) {
        // The model's curved arm extends in local -Z (verified via its own
        // bounding box). rotY=heading points that arm back toward the road
        // for a pole on the +side; a pole on the mirrored -side needs the
        // opposite world direction, an extra +PI, to still reach in over the
        // carriageway instead of curving away from it on that side.
        const rotY = cp.heading + (side === -1 ? Math.PI : 0);
        const pos = new THREE.Vector3(cp.point.x, y, cp.point.z).addScaledVector(cp.binormal, edgeDist * side);
        out.push({ pos, rotY });
      }
    }
    return out;
  }, [roadCurve, roadCurveLength, halfWidth, lightingActive]);

  const signalPositions = useMemo(() => {
    const n = road.features.signal_count + (signalActive && road.features.signal_count === 0 ? 1 : 0);
    if (n === 0) return [];
    const out: THREE.Vector3[] = [];
    for (let k = 1; k <= n; k++) {
      const frac = k / (n + 1);
      const idx = Math.min(points.length - 1, Math.round(frac * (points.length - 1)));
      const p = points[idx];
      const [px, pz] = perpendicular(p.ribbonHeading);
      const [wx, wy, wz] = toWorld(p.x, p.y, p.elev);
      out.push(new THREE.Vector3(wx - px * (halfWidth + 1.5), wy - shoulderDrop(1.5), wz - pz * (halfWidth + 1.5)));
    }
    return out;
  }, [points, halfWidth, road.features.signal_count, signalActive]);

  // intersections_count includes signalized ones; the remainder are stop-controlled
  // (or fully uncontrolled) and are what risk_engine's uncontrolled_intersections
  // factor actually penalizes, so they get a distinct real stop-sign marker.
  const stopSignPositions = useMemo(() => {
    const n = Math.max(0, road.context.intersections_count - road.features.signal_count);
    if (n === 0 || points.length < 2) return [];
    const out: { pos: THREE.Vector3; rotY: number }[] = [];
    for (let k = 1; k <= n; k++) {
      const frac = (k - 0.5) / n;
      const idx = Math.min(points.length - 1, Math.round(frac * (points.length - 1)));
      const p = points[idx];
      const [px, pz] = perpendicular(p.ribbonHeading);
      const [wx, wy, wz] = toWorld(p.x, p.y, p.elev);
      out.push({
        pos: new THREE.Vector3(wx + px * (halfWidth + 1.5), wy - shoulderDrop(1.5), wz + pz * (halfWidth + 1.5)),
        rotY: -p.heading,
      });
    }
    return out;
  }, [points, halfWidth, road.context.intersections_count, road.features.signal_count]);

  const hazardPoints = useMemo(
    () => points.filter((p) => p.hazard && !guardrailActive),
    [points, guardrailActive]
  );

  const signalLampRefs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    const phase = clock.elapsedTime % 30;
    const red = phase > 18;
    signalLampRefs.current.forEach((mesh) => {
      if (!mesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(red ? "#ef4444" : "#22c55e");
      mat.emissive.set(red ? "#ef4444" : "#22c55e");
    });
  });

  const [hoveredHazard, setHoveredHazard] = useState<number | null>(null);

  return (
    <group>
      {guardrailPlacements.map((g, i) => (
        <Clone key={i} object={guardrailScene} position={g.pos} rotation={[0, g.rotY, 0]} scale={GUARDRAIL_SCALE} castShadow receiveShadow />
      ))}

      {speedBumpPlacements.map((b, i) => (
        <mesh key={i} position={b.pos} rotation={[0, b.rotY, 0]} castShadow receiveShadow>
          <boxGeometry args={[SPEED_BUMP_THICKNESS, SPEED_BUMP_HEIGHT, halfWidth * 2]} />
          <meshStandardMaterial map={speedBumpTex} roughness={0.85} />
        </mesh>
      ))}

      {lightingActive && lampPositions.map((l, i) => (
        <group key={i} position={l.pos} rotation={[0, l.rotY, 0]}>
          <Clone object={streetlightGltf.scene} scale={STREETLIGHT_SCALE} castShadow />
          {/* Sits at the model's own (scaled) arm-end position — the old
              hardcoded [1.6, 6.2, 0] assumed a ~6m pole the actual model
              never reached at the old scale, which is why it read as a bulb
              floating with nothing under it. */}
          <mesh position={[0, STREETLIGHT_UNSCALED_HEIGHT * STREETLIGHT_SCALE, -STREETLIGHT_UNSCALED_ARM * STREETLIGHT_SCALE]}>
            <sphereGeometry args={[0.35, 8, 8]} />
            <meshStandardMaterial color="#fff4c4" emissive="#ffe28a" emissiveIntensity={2} toneMapped={false} />
            <pointLight color="#ffe28a" intensity={6} distance={16} decay={2} />
          </mesh>
        </group>
      ))}

      {signalPositions.map((pos, i) => (
        <group key={i} position={[pos.x, pos.y, pos.z]}>
          <mesh position={[0, 2.2, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 4.4, 6]} />
            <meshStandardMaterial color="#33383f" />
          </mesh>
          <mesh position={[0, 4.3, 0.3]} ref={(el) => (signalLampRefs.current[i] = el)}>
            <sphereGeometry args={[0.28, 10, 10]} />
            <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={2} toneMapped={false} />
          </mesh>
        </group>
      ))}

      {stopSignPositions.map((s, i) => (
        <Clone key={i} object={stopSignGltf.scene} position={s.pos} rotation={[0, s.rotY, 0]} scale={STOP_SIGN_SCALE} castShadow />
      ))}

      {crossingActive && points[Math.floor(points.length / 2)] && (
        <CrossingStripes point={points[Math.floor(points.length / 2)]} halfWidth={halfWidth} />
      )}

      {hazardPoints.map((p, i) => {
        const [wx, wy, wz] = toWorld(p.x, p.y, p.elev);
        const [px, pz] = perpendicular(p.ribbonHeading);
        return (
          <group key={i} position={[wx - px * (halfWidth + 1), wy - shoulderDrop(1), wz - pz * (halfWidth + 1)]}
            onPointerOver={() => setHoveredHazard(i)} onPointerOut={() => setHoveredHazard(null)}>
            <Clone object={warningGltf.scene} scale={hoveredHazard === i ? WARNING_SIGN_SCALE * 1.15 : WARNING_SIGN_SCALE} />
            <Clone object={coneGltf.scene} position={[1.4, 0, 0.6]} scale={CONE_SCALE} />
            <Clone object={coneGltf.scene} position={[1.9, 0, -0.5]} scale={CONE_SCALE} />
            {hoveredHazard === i && (
              <Html position={[0, 2.4, 0]} center distanceFactor={22} style={{ pointerEvents: "none" }}>
                <div className="mono text-2xs bg-ink-900/95 border border-risk-high/60 text-risk-high px-2 py-1 rounded whitespace-nowrap">
                  SHARP CURVE — NO GUARDRAIL
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

// One real stripe + gap period, in meters — MUTCD-style crossings run
// roughly 0.4-0.6m stripes with an equal gap; 1m/period is a reasonable
// real-world middle value.
const CROSSING_STRIPE_PERIOD_M = 1.0;
const CROSSING_LENGTH_M = 3.0; // how far the crossing extends along the road (pedestrian walking direction)

function CrossingStripes({ point, halfWidth }: { point: ReturnType<typeof buildPath>[number]; halfWidth: number }) {
  const [px, pz] = perpendicular(point.ribbonHeading);
  const [wx, wy, wz] = toWorld(point.x, point.y, point.elev);
  const tex = useMemo(() => {
    const t = crossingTexture();
    // The old five-stripe version used planeGeometry(0.6, halfWidth*2) under
    // this same rotation — first arg along the road, second arg across it —
    // so repeat.y (the second/height axis) is what needs to alternate stripes
    // across the road's width; repeat.x stays 1 (a single uniform zone along
    // the direction pedestrians walk).
    t.repeat.set(1, (halfWidth * 2) / CROSSING_STRIPE_PERIOD_M);
    return t;
  }, [halfWidth]);
  return (
    // Same -PI/2, atan2(pz, px) orientation the five separate stripe planes
    // used before (proven correct — each stripe already lined up across the
    // road) — one combined, textured plane instead of independently offset copies.
    <mesh position={[wx, wy + 0.035, wz]} rotation={[-Math.PI / 2, 0, Math.atan2(pz, px)]}>
      <planeGeometry args={[CROSSING_LENGTH_M, halfWidth * 2]} />
      <meshStandardMaterial map={tex} roughness={0.9} />
    </mesh>
  );
}

useGLTF.preload(GUARDRAIL_MODEL);
useGLTF.preload(STREETLIGHT_MODEL);
useGLTF.preload(WARNING_SIGN_MODEL);
useGLTF.preload(STOP_SIGN_MODEL);
useGLTF.preload(CONE_MODEL);
