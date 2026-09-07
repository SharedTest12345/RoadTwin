import { useMemo } from "react";
import { useGLTF, Clone } from "@react-three/drei";
import * as THREE from "three";
import type { Road, SimResult, VehicleFrame } from "../../../types";
import { buildPath, toWorld, perpendicular, sampleAlongPath } from "../../../three/geometryUtils";
import { CAR_MODELS } from "../../../three/vehicleModels";

interface Props {
  road: Road;
  sim: SimResult | null;
  simTime: number;
}

// Kenney's Car Kit models are modeled ~4.5 units long at roughly a 1:1 meter
// scale. The model's forward axis is +Z, not -Z. 1.05 (near-real scale) read as
// small against the rest of the scene — bumped up as a deliberate visual-scale
// choice, not a realism one.
const MODEL_SCALE = 1.65;
const MODEL_ROT_OFFSET = 0;

function findFrameBounds(sim: SimResult, t: number) {
  const frames = sim.frames;
  if (frames.length === 0) return null;
  if (t <= frames[0].t) return { a: frames[0], b: frames[0], f: 0 };
  if (t >= frames[frames.length - 1].t) return { a: frames[frames.length - 1], b: frames[frames.length - 1], f: 0 };
  let lo = 0, hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = frames[lo], b = frames[hi];
  const f = (t - a.t) / Math.max(b.t - a.t, 1e-6);
  return { a, b, f };
}

// `s` (arc length along the road) and `lane_offset_m` interpolate as plain
// scalars — no wraparound to worry about the way raw heading degrees had, and
// re-deriving position/heading fresh from the smooth curve at the interpolated
// `s` (see below) means this no longer needs to reconstruct a heading at all.
function interpolateVehicles(a: VehicleFrame[], b: VehicleFrame[], f: number): VehicleFrame[] {
  const bMap = new Map(b.map((v) => [v.id, v]));
  const out: VehicleFrame[] = [];
  for (const va of a) {
    const vb = bMap.get(va.id);
    if (!vb) continue;
    out.push({
      id: va.id, lane: va.lane, braking: vb.braking, lane_offset_m: vb.lane_offset_m,
      s: va.s + (vb.s - va.s) * f,
      v_ms: va.v_ms + (vb.v_ms - va.v_ms) * f,
    });
  }
  return out;
}

export function Vehicles({ road, sim, simTime }: Props) {
  const points = useMemo(() => buildPath(road), [road]);
  const gltfs = useGLTF(CAR_MODELS);

  const vehicles = useMemo(() => {
    if (!sim) return [];
    const bounds = findFrameBounds(sim, simTime);
    if (!bounds) return [];
    return interpolateVehicles(bounds.a.vehicles, bounds.b.vehicles, bounds.f);
  }, [sim, simTime]);

  const activeConflicts = useMemo(() => {
    if (!sim) return [];
    return sim.conflicts.filter((c) => Math.abs(c.t - simTime) < 0.9);
  }, [sim, simTime]);

  return (
    <group>
      {vehicles.map((v) => {
        // Sample the SAME smooth curve Road.tsx/Terrain.tsx render against, at
        // this vehicle's actual arc length — not the backend's raw straight-
        // chord lookup — so the car always sits exactly on the rendered curve
        // instead of cutting corners on a bend.
        const p = sampleAlongPath(points, v.s);
        // ribbonHeading (the miter-bisector direction), NOT heading (the raw
        // segment direction), is what every other lateral offset in the scene
        // uses (Road.tsx's edges/markings, Infrastructure's guardrail/signs,
        // Scenery's placement) — heading can diverge from the true perpendicular
        // by 10-15deg right at a sharp turn, which pushed a "centered" lane
        // offset sideways enough to land on the lane line exactly where curves
        // are tightest. perpendicular() offsets are applied to WORLD coordinates
        // after toWorld everywhere else in the scene, not pre-toWorld local x/y.
        const [px, pz] = perpendicular(p.ribbonHeading);
        const [bx, by, bz] = toWorld(p.x, p.y, p.elev);
        const wx = bx + px * v.lane_offset_m, wy = by, wz = bz + pz * v.lane_offset_m;
        // p.heading is buildPath's world-plane heading (atan2(-dy, dx), already
        // accounting for toWorld's y->-z flip) — for a +Z-forward model this
        // needs the complementary angle, pi/2 - heading (see geometryUtils'
        // perpendicular/heading convention notes).
        const headingRad = Math.PI / 2 - p.heading;
        const modelIdx = v.id % CAR_MODELS.length;
        const scene = gltfs[modelIdx]?.scene;
        return (
          <group key={v.id} position={[wx, wy, wz]} rotation={[0, headingRad + MODEL_ROT_OFFSET, 0]}>
            {scene && <Clone object={scene} scale={MODEL_SCALE} castShadow receiveShadow />}
            <mesh position={[0, 0.35, -2.15]}>
              <boxGeometry args={[1.5, 0.3, 0.06]} />
              <meshStandardMaterial
                color={v.braking ? "#ff2f2f" : "#7a1010"}
                emissive={v.braking ? "#ff2f2f" : "#7a1010"}
                emissiveIntensity={v.braking ? 3 : 0.6}
                toneMapped={false}
              />
            </mesh>
            <mesh position={[0, 0.35, 2.15]}>
              <boxGeometry args={[1.5, 0.3, 0.06]} />
              <meshStandardMaterial color="#fff8dd" emissive="#fff8dd" emissiveIntensity={1.2} toneMapped={false} />
            </mesh>
          </group>
        );
      })}

      {activeConflicts.map((c, i) => {
        const p = sampleAlongPath(points, c.s);
        const [wx, wy, wz] = toWorld(p.x, p.y, p.elev);
        return (
          <group key={i} position={[wx, wy + 0.1, wz]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[1.1, 1.5, 24]} />
              <meshBasicMaterial color="#ff3030" transparent opacity={0.85} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

useGLTF.preload(CAR_MODELS);
