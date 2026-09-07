import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useGLTF, Clone } from "@react-three/drei";
import * as THREE from "three";
import type { Road, SimResult } from "../../../types";
import { buildPath, toWorld, perpendicular, sampleAlongPath, roadHalfWidth, buildRoadCurve, sampleRoadCurveAt } from "../../../three/geometryUtils";
import type { PathPoint, CurvePoint } from "../../../three/geometryUtils";
import { shoulderDrop } from "../../../three/terrainHeight";
import { STREETLIGHT_MODEL, WARNING_SIGN_MODEL, STOP_SIGN_MODEL, CONE_MODEL } from "../../../three/propModels";
import { speedBumpTexture } from "../../../three/textures";
import { useStore } from "../../../state/store";

interface Props {
  road: Road;
  sim: SimResult | null;
  guardrailActive: boolean;
  lightingActive: boolean;
  sidewalkActive: boolean;
  crossingActive: boolean;
  signalActive: boolean;
  speedBumpsActive: boolean;
}

// Guardrail is a procedural bollard-style post (see GuardPosts below), not a
// GLTF import — real crash-barrier/bollard post spacing runs roughly 2-4m.
const GUARD_POST_SPACING_M = 3;
const GUARD_POST_HEIGHT = 0.8;
const GUARD_POST_WIDTH = 0.16;
const GUARD_POST_BASE_SIZE = 0.4;
const GUARD_POST_BASE_THICKNESS = 0.04;
const GUARD_POST_COLOR = "#f2c200";
const GUARD_POST_CAP_COLOR = "#f4f4f2";
const GUARD_POST_BASE_COLOR = "#3a3a3a";
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
// A bollard post's base plate is square, so its rotation is cosmetic (unlike
// the old rigid fence panel, which HAD to be tangent-aligned to look right) —
// still oriented to the local tangent so the base plate's edges line up with
// the road rather than sitting at a random angle from curve to curve.
const GUARD_POST_ROT_OFFSET = 0;
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
// A raised zebra crossing (see CrossingBump) already IS a speed hump — a
// separate flat speed bump placed right at/next to it is redundant and reads
// as two traffic-calming features stacked on top of each other.
const CROSSING_EXCLUSION_M = 8;
// Shared "is this stretch straight enough" check — used both to place the
// crossing off the literal midpoint index (not wherever a curve happens to
// be) and to skip speed bumps that would otherwise land mid-turn.
const STRAIGHT_WINDOW_M = 15;
const STRAIGHT_THRESHOLD_RAD = (6 * Math.PI) / 180;
// Real crash-barrier-style traffic signal cycle: matches traffic_sim.py's
// `cycle = 30.0` / `phase > 18.0` exactly — see the sync note on the signal
// useFrame below for why this has to match bit-for-bit.
const SIGNAL_CYCLE_S = 30;
const SIGNAL_GREEN_S = 18;
// Purely a DISPLAY anticipation — the light shows red/green starting this
// many seconds before the real (backend-matching) transition, like a real
// signal giving drivers a heads-up. Only the color changes early: the
// physics that actually stops vehicles (traffic_sim.py's signal_red()) is
// untouched and still flips at the exact SIGNAL_GREEN_S / SIGNAL_CYCLE_S
// boundaries, so a car can legally still be moving through on green while
// the light already reads red, or still be held by a "logically red" signal
// that's already showing green.
const SIGNAL_RED_PREVIEW_S = 3;
const SIGNAL_GREEN_PREVIEW_S = 3;
// A pedestrian crossing gets its own signal, planted just before the
// crossing's near edge (a real stop line) — matches traffic_sim.py's
// CROSSING_LENGTH_M/CROSSING_SIGNAL_SETBACK_M exactly, so the backend
// actually stops traffic at the SAME spot this signal is drawn.
const CROSSING_LENGTH_M = 3.0; // how much ROAD LENGTH the crossing band covers (a car drives ~3m over it)
const CROSSING_SIGNAL_SETBACK_M = 4.0;

/** Binary-searches `points` (sorted by ascending arc length) for the index
 * nearest arc-length `s`. */
function nearestIndexForS(points: PathPoint[], s: number): number {
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].s <= s) lo = mid; else hi = mid;
  }
  return s - points[lo].s <= points[hi].s - s ? lo : hi;
}

/** Total heading change over a `windowM`-wide window centered on points[i] —
 * near 0 on a straight stretch, larger through a turn (gradual or sharp). */
function curvatureAt(points: PathPoint[], i: number, windowM: number): number {
  const n = points.length;
  let j = i, back = 0;
  while (j > 0 && back < windowM) { back += points[j].s - points[j - 1].s; j--; }
  let k = i, fwd = 0;
  while (k < n - 1 && fwd < windowM) { fwd += points[k + 1].s - points[k].s; k++; }
  let diff = Math.abs(points[k].heading - points[j].heading);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff;
}

/** Nearest index to arc-length `targetS` whose local curvature is under
 * `thresholdRad` — searches outward from the target in both directions
 * (nearest first) instead of only ever checking the exact target index, so a
 * traffic signal (etc.) that would otherwise land right before/inside a
 * sharp turn slides to the closest sensible approach point instead. Falls
 * back to the original target index if the road curves the entire way. */
function nearestStraightIndex(points: PathPoint[], targetS: number, windowM: number, thresholdRad: number): number {
  const n = points.length;
  const start = nearestIndexForS(points, targetS);
  if (curvatureAt(points, start, windowM) <= thresholdRad) return start;
  for (let d = 1; d < n; d++) {
    const hi = start + d;
    if (hi < n && curvatureAt(points, hi, windowM) <= thresholdRad) return hi;
    const lo = start - d;
    if (lo >= 0 && curvatureAt(points, lo, windowM) <= thresholdRad) return lo;
  }
  return start;
}

export function Infrastructure({ road, sim, guardrailActive, lightingActive, sidewalkActive, crossingActive, signalActive, speedBumpsActive }: Props) {
  const points = useMemo(() => buildPath(road), [road]);
  const halfWidth = roadHalfWidth(road);
  // The SAME curve Road.tsx renders its asphalt/edge-lines from — sampling
  // this (not buildPath's raw points directly) is what guarantees the
  // guardrail/lamp actually land on the rendered white line rather than a
  // separately-computed, slightly different curve through the same points.
  const { curve: roadCurve, length: roadCurveLength } = useMemo(() => buildRoadCurve(road), [road]);

  const streetlightGltf = useGLTF(STREETLIGHT_MODEL);
  const warningGltf = useGLTF(WARNING_SIGN_MODEL);
  const stopSignGltf = useGLTF(STOP_SIGN_MODEL);
  const coneGltf = useGLTF(CONE_MODEL);

  const guardrailPlacements = useMemo(() => {
    if (!guardrailActive || roadCurveLength < 1e-6) return [];
    const out: { pos: THREE.Vector3; rotY: number }[] = [];
    const edgeDist = halfWidth + EDGE_LINE_OFFSET_M;
    // Both edges — Road.tsx's leftEdgeGeom (+edgeDist along binormal) and
    // rightEdgeGeom (-edgeDist along binormal) are the exact two lines this
    // now targets, sampling the SAME curve object those lines are drawn from
    // instead of buildPath's raw points + a separately-computed 2D bisector,
    // which is what let the rail's distance match the line's distance in
    // NUMBER while still not actually landing on the line's real position.
    for (let s = 0; s < roadCurveLength; s += GUARD_POST_SPACING_M) {
      const cp = sampleRoadCurveAt(roadCurve, roadCurveLength, s);
      for (const side of [1, -1] as const) {
        out.push({
          pos: cp.point.clone().addScaledVector(cp.binormal, edgeDist * side),
          rotY: -cp.heading + GUARD_POST_ROT_OFFSET,
        });
      }
    }
    return out;
  }, [roadCurve, roadCurveLength, halfWidth, guardrailActive]);

  const pointsTotal = points.length > 1 ? points[points.length - 1].s : 0;

  // Local estimate (nearest-to-midpoint straight point) — used ONLY as a
  // fallback before the first sim result has loaded. crossingS below prefers
  // the backend's own resolved crossing_frac.
  const crossingEstimatePoint = useMemo(() => {
    if (!crossingActive || points.length < 3) return null;
    const mid = pointsTotal / 2;
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      if (curvatureAt(points, i, STRAIGHT_WINDOW_M) > STRAIGHT_THRESHOLD_RAD) continue;
      const dist = Math.abs(points[i].s - mid);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    if (best === -1) {
      let minCurv = Infinity;
      for (let i = 0; i < points.length; i++) {
        const c = curvatureAt(points, i, STRAIGHT_WINDOW_M);
        if (c < minCurv) { minCurv = c; best = i; }
      }
    }
    return points[best];
  }, [points, pointsTotal, crossingActive]);

  // Single source of truth for the crossing's position, in roadCurve's own
  // arc-length domain: the BACKEND's resolved crossing_frac (see
  // traffic_sim.py's crossing_center_s), not a second, independently
  // re-searched position. Two separate "nearest straight point to the
  // midpoint" searches — one over this buildPath's dense resampled points,
  // one over the backend's sparse raw OSM points — can walk outward at very
  // different physical step sizes and settle on two different straight
  // stretches of the same road. That's what put the rendered zebra crossing
  // at one spot while the traffic light/pedestrian-crossing physics treated
  // an entirely different spot (often wherever an unrelated real signal
  // happened to sit) as "the crossing." Falls back to the local estimate
  // only until the first sim result arrives.
  const crossingS = useMemo(() => {
    if (!crossingActive) return null;
    if (sim && sim.crossing_frac != null && roadCurveLength > 1e-6) return sim.crossing_frac * roadCurveLength;
    if (!crossingEstimatePoint || pointsTotal < 1e-6 || roadCurveLength < 1e-6) return null;
    return (crossingEstimatePoint.s / pointsTotal) * roadCurveLength;
  }, [crossingActive, sim, roadCurveLength, crossingEstimatePoint, pointsTotal]);

  const crossingCP = useMemo(
    () => (crossingS != null ? sampleRoadCurveAt(roadCurve, roadCurveLength, crossingS) : null),
    [crossingS, roadCurve, roadCurveLength]
  );

  const speedBumpPlacements = useMemo(() => {
    if (!speedBumpsActive || points.length < 2) return [];
    const out: { pos: THREE.Vector3; rotY: number }[] = [];
    const total = pointsTotal;
    // Reproject crossingS (roadCurve domain) into points' own arc-length
    // domain for comparison against this loop's own `s` values.
    const crossingSOnPoints = crossingS != null && roadCurveLength > 1e-6 ? (crossingS / roadCurveLength) * total : null;
    for (let s = SPEED_BUMP_SPACING_M; s < total; s += SPEED_BUMP_SPACING_M) {
      // A raised zebra crossing already slows traffic — don't stack a second
      // hump right on top of/next to it.
      if (crossingSOnPoints !== null && Math.abs(s - crossingSOnPoints) < CROSSING_EXCLUSION_M) continue;
      // Skip a bump that would land mid-turn — same straightness check the
      // crossing placement above uses.
      if (curvatureAt(points, nearestIndexForS(points, s), STRAIGHT_WINDOW_M) > STRAIGHT_THRESHOLD_RAD) continue;
      const p = sampleAlongPath(points, s);
      const [wx, wy, wz] = toWorld(p.x, p.y, p.elev);
      // Same -heading rotation used for the guard posts' base-plate orientation
      // (see GUARD_POST_ROT_OFFSET above) — here aligning the box's THIN
      // local-X dimension with the road tangent, so its wide local-Z
      // dimension spans the full carriageway width automatically.
      out.push({ pos: new THREE.Vector3(wx, wy + SPEED_BUMP_HEIGHT / 2, wz), rotY: -p.heading });
    }
    return out;
  }, [points, pointsTotal, speedBumpsActive, crossingS, roadCurveLength]);

  const speedBumpTex = useMemo(() => {
    const t = speedBumpTexture();
    t.repeat.set(1, (halfWidth * 2) / 1.0);
    return t;
  }, [halfWidth]);

  // 25m (+ a lamp on BOTH sides every interval, since replaced by alternating
  // single-side poles below) read as a solid double wall of light rather than
  // real streetlights, which run closer to 40-50m apart on an ordinary street.
  const LAMP_SPACING_M = 48;

  // A traffic signal literally sits IN the road unless it's anchored to the
  // same curve/binormal frame the guardrail/lamps use — the old version used
  // buildPath's raw-point + separately-computed 2D bisector, which (like the
  // crossing before it) doesn't land exactly on the rendered edge and could
  // put the pole on the carriageway itself instead of beside it. Mounted at
  // the SAME edge distance as a streetlight, one side only, so it reads as
  // "a streetlight replaced by a signal" (see lampPositions' skip below) —
  // not a separate structure standing in the road.
  //
  // A pedestrian crossing ALWAYS gets its own signal, planted just before the
  // crossing's near edge — real crosswalk stop line — matching
  // traffic_sim.py's crossing-tied signal exactly (same CROSSING_LENGTH_M/
  // CROSSING_SIGNAL_SETBACK_M constants), so this is the SAME position the
  // backend physics actually stops traffic at, not a decoration standing
  // somewhere unrelated to where cars queue. Any other real signals
  // (signal_count / the general "add signal" toggle) still get their own
  // straight-nudged fractional positions elsewhere on the road.
  const signalPositions = useMemo(() => {
    if (roadCurveLength < 1e-6 || points.length < 2) return [];
    const out: { pos: THREE.Vector3; s: number }[] = [];
    const edgeDist = halfWidth + EDGE_LINE_OFFSET_M + LAMP_EDGE_DEVIATION_M;

    const place = (sCurve: number) => {
      const cp = sampleRoadCurveAt(roadCurve, roadCurveLength, sCurve);
      const y = cp.point.y - shoulderDrop(2.5);
      const pos = new THREE.Vector3(cp.point.x, y, cp.point.z).addScaledVector(cp.binormal, edgeDist);
      out.push({ pos, s: sCurve });
    };

    let crossingSignalS: number | null = null;
    if (crossingS != null) {
      crossingSignalS = Math.max(0, crossingS - CROSSING_LENGTH_M / 2 - CROSSING_SIGNAL_SETBACK_M);
      place(crossingSignalS);
    }

    const n = road.features.signal_count + (signalActive && road.features.signal_count === 0 ? 1 : 0);
    for (let k = 1; k <= n; k++) {
      const frac = k / (n + 1);
      // Nudged to the nearest straight-enough point (nearestStraightIndex) so
      // a signal doesn't land immediately before/inside a sharp turn, where
      // it makes no traffic-control sense and visually crowds the bend.
      const idx = nearestStraightIndex(points, frac * pointsTotal, STRAIGHT_WINDOW_M, STRAIGHT_THRESHOLD_RAD);
      // points and roadCurve are two different (very close but not
      // byte-identical) fits through the same route — reproject by fraction
      // rather than by raw arc length so the chosen point maps onto roughly
      // the same physical spot on whichever curve sampleRoadCurveAt uses.
      const s = pointsTotal > 1e-6 ? (points[idx].s / pointsTotal) * roadCurveLength : frac * roadCurveLength;
      if (crossingSignalS !== null && Math.abs(s - crossingSignalS) < 25) continue; // already covered by the crossing's own signal
      place(s);
    }
    return out;
  }, [points, pointsTotal, roadCurve, roadCurveLength, halfWidth, road.features.signal_count, signalActive, crossingS]);

  const lampPositions = useMemo(() => {
    if (!lightingActive || roadCurveLength < 1e-6) return [];
    const out: { pos: THREE.Vector3; rotY: number }[] = [];
    // Anchored to the same curve/binormal the guardrail (and Road.tsx's own
    // edge lines) now use, so the pole base's distance from the line is
    // measured off the actual rendered line, not a separately-tracked curve.
    const edgeDist = halfWidth + EDGE_LINE_OFFSET_M + LAMP_EDGE_DEVIATION_M;
    let stepIdx = 0;
    for (let s = 0; s < roadCurveLength; s += LAMP_SPACING_M, stepIdx++) {
      const cp = sampleRoadCurveAt(roadCurve, roadCurveLength, s);
      // Roadside props stand on the embankment slope / ground beside the road,
      // not at carriageway height.
      const y = cp.point.y - shoulderDrop(2.5);
      // One pole per step, alternating sides — a real street has poles
      // staggered left/right down its length, not a facing pair at every
      // interval on BOTH edges (that read as a solid double wall of light).
      const side: 1 | -1 = stepIdx % 2 === 0 ? 1 : -1;
      // A traffic signal occupies this exact +side slot instead of a lamp
      // — "replacing a streetlight," not standing alongside one.
      if (side === 1 && signalPositions.some((sp) => Math.abs(sp.s - s) < LAMP_SPACING_M / 2)) continue;
      // The model's curved arm extends in local -Z (verified via its own
      // bounding box). Local -Z after a Y-rotation by theta points to world
      // (-sin(theta), 0, -cos(theta)) — for that to equal the road's own
      // -binormal (i.e. reach IN over the carriageway from a +side pole)
      // theta must be -heading, not +heading (verified numerically: the
      // previous +heading formula only got the arm ~68deg off, dot product
      // 0.36 instead of 1.0, against the true inward direction). A pole on
      // the mirrored -side needs the opposite world direction, +PI.
      const rotY = -cp.heading + (side === -1 ? Math.PI : 0);
      const pos = new THREE.Vector3(cp.point.x, y, cp.point.z).addScaledVector(cp.binormal, edgeDist * side);
      out.push({ pos, rotY });
    }
    return out;
  }, [roadCurve, roadCurveLength, halfWidth, lightingActive, signalPositions]);

  // intersections_count includes signalized ones; the remainder are stop-controlled
  // (or fully uncontrolled) and are what risk_engine's uncontrolled_intersections
  // factor actually penalizes, so they get a distinct real stop-sign marker.
  // Curve/binormal-anchored like the other roadside props above, for the same
  // reason: buildPath's raw-point + 2D-bisector system doesn't land exactly
  // on the rendered edge, which is what let a sign sit slightly on the
  // carriageway (or float off the true shoulder height) on a curve.
  const stopSignPositions = useMemo(() => {
    const n = Math.max(0, road.context.intersections_count - road.features.signal_count);
    if (n === 0 || roadCurveLength < 1e-6) return [];
    const out: { pos: THREE.Vector3; rotY: number }[] = [];
    const edgeDist = halfWidth + EDGE_LINE_OFFSET_M + 1.5;
    for (let k = 1; k <= n; k++) {
      const frac = (k - 0.5) / n;
      const s = frac * roadCurveLength;
      const cp = sampleRoadCurveAt(roadCurve, roadCurveLength, s);
      const y = cp.point.y - shoulderDrop(1.5);
      out.push({
        pos: new THREE.Vector3(cp.point.x, y, cp.point.z).addScaledVector(cp.binormal, -edgeDist),
        rotY: -cp.heading,
      });
    }
    return out;
  }, [roadCurve, roadCurveLength, halfWidth, road.context.intersections_count, road.features.signal_count]);

  const hazardPoints = useMemo(
    () => points.filter((p) => p.hazard && !guardrailActive),
    [points, guardrailActive]
  );

  // Was driven by clock.elapsedTime (real wall-clock time since the canvas
  // mounted) — completely decoupled from traffic_sim.py's own signal_red(),
  // which gates on simTime + that signal's own arc-length position. Vehicles
  // stop for the BACKEND's red phase; the light showing a DIFFERENT color at
  // that moment is what read as "nobody follows the traffic light." Reading
  // simTime via getState() (not a reactive useStore subscription) avoids
  // re-rendering this whole component every frame just to recolor a sphere.
  const signalLampRefs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    const simTime = useStore.getState().simTime;
    signalPositions.forEach((sp, i) => {
      const mesh = signalLampRefs.current[i];
      if (!mesh) return;
      const phase = (simTime + sp.s) % SIGNAL_CYCLE_S;
      const red = phase > SIGNAL_GREEN_S - SIGNAL_RED_PREVIEW_S && phase < SIGNAL_CYCLE_S - SIGNAL_GREEN_PREVIEW_S;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(red ? "#ef4444" : "#22c55e");
      mat.emissive.set(red ? "#ef4444" : "#22c55e");
    });
  });

  const [hoveredHazard, setHoveredHazard] = useState<number | null>(null);

  return (
    <group>
      <GuardPosts placements={guardrailPlacements} />

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
            <sphereGeometry args={[0.55, 8, 8]} />
            {/* toneMapped=false + a well-above-threshold emissive value (Scene.tsx's
                Bloom pass gates on luminanceThreshold=1.0) is what actually feeds the
                bloom pass — a bigger sphere also gives the blur a larger bright seed
                to glow from, not just a brighter one. */}
            <meshStandardMaterial color="#fff4c4" emissive="#ffe28a" emissiveIntensity={9} toneMapped={false} />
            <pointLight color="#ffe28a" intensity={12} distance={20} decay={2} />
          </mesh>
        </group>
      ))}

      {signalPositions.map((sp, i) => (
        <group key={i} position={sp.pos}>
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

      {crossingActive && crossingCP && (
        <CrossingBump cp={crossingCP} halfWidth={halfWidth} />
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

// A single yellow bollard-style guard post — squat square post, light cap,
// dark base plate — instead of a straight rigid fence panel. Rendered as 3
// instanced meshes (post/cap/base) rather than one component per placement:
// a 2km road at GUARD_POST_SPACING_M=3 on both edges is well over a thousand
// posts, and instancing keeps that at 3 draw calls total instead of thousands.
function GuardPosts({ placements }: { placements: { pos: THREE.Vector3; rotY: number }[] }) {
  const postRef = useRef<THREE.InstancedMesh>(null);
  const capRef = useRef<THREE.InstancedMesh>(null);
  const baseRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    placements.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rotY);
      m.compose(new THREE.Vector3(p.pos.x, p.pos.y + GUARD_POST_BASE_THICKNESS + GUARD_POST_HEIGHT / 2, p.pos.z), q, scale);
      postRef.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p.pos.x, p.pos.y + GUARD_POST_BASE_THICKNESS + GUARD_POST_HEIGHT + 0.03, p.pos.z), q, scale);
      capRef.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p.pos.x, p.pos.y + GUARD_POST_BASE_THICKNESS / 2, p.pos.z), q, scale);
      baseRef.current?.setMatrixAt(i, m);
    });
    if (postRef.current) postRef.current.instanceMatrix.needsUpdate = true;
    if (capRef.current) capRef.current.instanceMatrix.needsUpdate = true;
    if (baseRef.current) baseRef.current.instanceMatrix.needsUpdate = true;
  }, [placements]);

  const count = placements.length;
  if (count === 0) return null;

  return (
    <group>
      <instancedMesh key={`post-${count}`} ref={postRef} args={[undefined, undefined, count]} castShadow receiveShadow>
        <boxGeometry args={[GUARD_POST_WIDTH, GUARD_POST_HEIGHT, GUARD_POST_WIDTH]} />
        <meshStandardMaterial color={GUARD_POST_COLOR} roughness={0.5} metalness={0.2} />
      </instancedMesh>
      <instancedMesh key={`cap-${count}`} ref={capRef} args={[undefined, undefined, count]} castShadow>
        <cylinderGeometry args={[GUARD_POST_WIDTH * 0.75, GUARD_POST_WIDTH * 0.75, 0.06, 12]} />
        <meshStandardMaterial color={GUARD_POST_CAP_COLOR} roughness={0.4} metalness={0.3} />
      </instancedMesh>
      <instancedMesh key={`base-${count}`} ref={baseRef} args={[undefined, undefined, count]} receiveShadow>
        <boxGeometry args={[GUARD_POST_BASE_SIZE, GUARD_POST_BASE_THICKNESS, GUARD_POST_BASE_SIZE]} />
        <meshStandardMaterial color={GUARD_POST_BASE_COLOR} roughness={0.6} metalness={0.4} />
      </instancedMesh>
    </group>
  );
}

// A raised zebra crossing, not a flat painted plane — a row of horizontal
// half-buried cylinders ("cut" cylinders: the flat road surface bisects each
// one, so only its rounded top half actually pokes up), each spanning the
// full carriageway width and colored alternately, giving both the "wavy
// corrugated speed table" profile and the zebra coloring in one shape. This
// also physically slows traffic on its own, which is why speedBumpPlacements
// above keeps a dead zone around it instead of stacking a flat bump next to it.
// (CROSSING_LENGTH_M itself is declared up with the other shared constants —
// signalPositions needs it too, to plant the crossing's signal before this
// band's near edge.)
const ZEBRA_RIDGE_SPACING_M = 0.5; // ridge-to-ridge, along the road
const ZEBRA_RIDGE_RADIUS = 0.09;
const ZEBRA_WHITE = "#e8e8e0";
const ZEBRA_DARK = "#33363c";

function CrossingBump({ cp, halfWidth }: { cp: CurvePoint; halfWidth: number }) {
  const base = cp.point;
  // World-space unit tangent — same atan2(tangent.z, tangent.x) convention as
  // CurvePoint.heading (see geometryUtils), so this is the direction a car
  // actually travels through the crossing, in world XZ.
  const tangent = useMemo(() => new THREE.Vector3(Math.cos(cp.heading), 0, Math.sin(cp.heading)), [cp.heading]);
  // Lays a cylinder (default axis local Y) on its side via -PI/2 about Z,
  // then yaws it by -heading-PI/2 so its (now-local-X) axis lines up with the
  // road's BINORMAL instead of its tangent — i.e. across the carriageway,
  // spanning it, rather than along the direction of travel (verified
  // numerically: dot(rotatedAxis, binormal) = 1.0 for this exact rotation).
  const ridgeRotation: [number, number, number] = [0, -cp.heading - Math.PI / 2, -Math.PI / 2];
  const ridges = useMemo(() => {
    const count = Math.max(3, Math.round(CROSSING_LENGTH_M / ZEBRA_RIDGE_SPACING_M) + 1);
    const start = -((count - 1) * ZEBRA_RIDGE_SPACING_M) / 2;
    return Array.from({ length: count }, (_, i) => ({
      offset: start + i * ZEBRA_RIDGE_SPACING_M,
      color: i % 2 === 0 ? ZEBRA_WHITE : ZEBRA_DARK,
    }));
  }, []);
  return (
    <group>
      {ridges.map((r, i) => (
        <mesh
          key={i}
          position={base.clone().addScaledVector(tangent, r.offset)}
          rotation={ridgeRotation}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[ZEBRA_RIDGE_RADIUS, ZEBRA_RIDGE_RADIUS, halfWidth * 2, 12]} />
          <meshStandardMaterial color={r.color} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

useGLTF.preload(STREETLIGHT_MODEL);
useGLTF.preload(WARNING_SIGN_MODEL);
useGLTF.preload(STOP_SIGN_MODEL);
useGLTF.preload(CONE_MODEL);
