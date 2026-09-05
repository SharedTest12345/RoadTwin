import { useMemo } from "react";
import { useGLTF, Clone } from "@react-three/drei";
import * as THREE from "three";
import type { Road, SimResult, VehicleFrame } from "../../types";
import { buildPath, toWorld } from "../../three/geometryUtils";
import { CAR_MODELS } from "../../three/vehicleModels";

interface Props {
  road: Road;
  sim: SimResult | null;
  simTime: number;
}

// Kenney's Car Kit models are modeled ~4.5 units long at roughly a 1:1 meter
// scale. The model's forward axis is +Z, not -Z as originally assumed — that
// assumption was never actually verified and had every car driving in reverse.
const MODEL_SCALE = 1.05;
const MODEL_ROT_OFFSET = 0;

function elevAt(points: ReturnType<typeof buildPath>, s: number): number {
  if (points.length === 0) return 0;
  if (s <= points[0].s) return points[0].elev;
  for (let i = 1; i < points.length; i++) {
    if (s <= points[i].s) {
      const t = (s - points[i - 1].s) / Math.max(points[i].s - points[i - 1].s, 1e-6);
      return points[i - 1].elev + t * (points[i].elev - points[i - 1].elev);
    }
  }
  return points[points.length - 1].elev;
}

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

function interpolateVehicles(a: VehicleFrame[], b: VehicleFrame[], f: number): VehicleFrame[] {
  const bMap = new Map(b.map((v) => [v.id, v]));
  const out: VehicleFrame[] = [];
  for (const va of a) {
    const vb = bMap.get(va.id);
    if (!vb) continue;
    out.push({
      id: va.id, lane: va.lane, braking: vb.braking,
      x: va.x + (vb.x - va.x) * f, y: va.y + (vb.y - va.y) * f,
      heading_deg: va.heading_deg + (vb.heading_deg - va.heading_deg) * f,
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
        const [wx, wy, wz] = toWorld(v.x, v.y, 0);
        const groundElev = elevAt(points, nearestS(points, v.x, v.y));
        const headingRad = (-v.heading_deg * Math.PI) / 180 + Math.PI / 2;
        const modelIdx = v.id % CAR_MODELS.length;
        const scene = gltfs[modelIdx]?.scene;
        return (
          <group key={v.id} position={[wx, wy + groundElev, wz]} rotation={[0, headingRad + MODEL_ROT_OFFSET, 0]}>
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
        const groundElev = elevAt(points, nearestS(points, c.x, c.y));
        const [wx, wy, wz] = toWorld(c.x, c.y, 0);
        return (
          <group key={i} position={[wx, wy + groundElev + 0.1, wz]}>
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

function nearestS(points: ReturnType<typeof buildPath>, x: number, y: number): number {
  let best = 0, bestD = Infinity;
  for (const p of points) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) { bestD = d; best = p.s; }
  }
  return best;
}

useGLTF.preload(CAR_MODELS);
