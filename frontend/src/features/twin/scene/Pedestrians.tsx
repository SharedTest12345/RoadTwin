import { useMemo } from "react";
import * as THREE from "three";
import type { PedestrianFrame, Road, SimResult } from "../../../types";
import { buildRoadCurve, sampleRoadCurveAt } from "../../../three/geometryUtils";

interface Props {
  road: Road;
  sim: SimResult | null;
  simTime: number;
}

// Low-poly stylized figure — box torso (has a visible "front" face, unlike a
// rotationally-symmetric capsule) + sphere head, matching the rest of the
// scene's Kenney-kit-style low-poly aesthetic rather than a realistic mesh.
const TORSO_W = 0.34, TORSO_H = 0.62, TORSO_D = 0.2;
const HIP_Y = 0.85, HEAD_Y = 1.5;
const HEAD_R = 0.15;
const SHIRT_COLORS = ["#c4453f", "#3f7fc4", "#4fae5c", "#c48f3f", "#8a5fc4", "#3fb8b0"];
const SKIN_COLORS = ["#e0ac7a", "#c98b5e", "#8d5a3c", "#f0c9a0"];

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

interface InterpPed extends PedestrianFrame {
  // +1/-1: which way this pedestrian is actually facing right now — along the
  // road while walking the sidewalk, across it while sweeping through a
  // crossing. Derived from the SIGN of motion between the two bounding
  // frames (ds while walking, d(lateral) while crossing) since the frame
  // itself only carries position, not a stored heading.
  dirSign: number;
}

function interpolatePedestrians(a: PedestrianFrame[], b: PedestrianFrame[], f: number): InterpPed[] {
  const bMap = new Map(b.map((p) => [p.id, p]));
  const out: InterpPed[] = [];
  for (const pa of a) {
    const pb = bMap.get(pa.id);
    if (!pb) continue;
    const ds = pb.s - pa.s;
    const dl = pb.lateral_m - pa.lateral_m;
    const dirSign = pb.crossing ? Math.sign(dl) || 1 : Math.sign(ds) || 1;
    out.push({
      id: pa.id, crossing: pb.crossing, dirSign,
      s: pa.s + ds * f,
      lateral_m: pa.lateral_m + dl * f,
    });
  }
  return out;
}

export function Pedestrians({ road, sim, simTime }: Props) {
  const { curve: roadCurve, length: roadCurveLength } = useMemo(() => buildRoadCurve(road), [road]);

  const pedestrians = useMemo(() => {
    if (!sim) return [];
    const bounds = findFrameBounds(sim, simTime);
    if (!bounds) return [];
    return interpolatePedestrians(bounds.a.pedestrians, bounds.b.pedestrians, bounds.f);
  }, [sim, simTime]);

  return (
    <group>
      {pedestrians.map((p) => {
        const cp = sampleRoadCurveAt(roadCurve, roadCurveLength, p.s);
        const wx = cp.point.x + cp.binormal.x * p.lateral_m;
        const wy = cp.point.y + cp.binormal.y * p.lateral_m;
        const wz = cp.point.z + cp.binormal.z * p.lateral_m;
        // Tangent reconstructed from cp.heading (same atan2(tangent.z, tangent.x)
        // convention CurvePoint documents) — faces along the road while
        // walking, across it (along binormal) while sweeping through a crossing.
        const tangent = new THREE.Vector3(Math.cos(cp.heading), 0, Math.sin(cp.heading));
        const dir = (p.crossing ? cp.binormal : tangent).clone().multiplyScalar(p.dirSign);
        const rotY = Math.atan2(dir.x, dir.z);
        const shirt = SHIRT_COLORS[p.id % SHIRT_COLORS.length];
        const skin = SKIN_COLORS[p.id % SKIN_COLORS.length];
        return (
          <group key={p.id} position={[wx, wy, wz]} rotation={[0, rotY, 0]}>
            <mesh position={[0, HIP_Y, 0]} castShadow receiveShadow>
              <boxGeometry args={[TORSO_W, TORSO_H, TORSO_D]} />
              <meshStandardMaterial color={shirt} roughness={0.8} />
            </mesh>
            <mesh position={[0, HEAD_Y, 0]} castShadow>
              <sphereGeometry args={[HEAD_R, 10, 10]} />
              <meshStandardMaterial color={skin} roughness={0.7} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
