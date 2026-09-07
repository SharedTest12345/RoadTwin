import { useMemo } from "react";
import { useGLTF, Clone } from "@react-three/drei";
import * as THREE from "three";
import type { Road, SimResult } from "../../../types";
import { buildRoadCurve, sampleRoadCurveAt } from "../../../three/geometryUtils";
import { vehiclesAt } from "../../../lib/simFrames";
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

export function Vehicles({ road, sim, simTime }: Props) {
  // The SAME curve Road.tsx renders the asphalt from (and Infrastructure.tsx
  // already anchors guardrails/lamps to) — sampling this instead of buildPath's
  // raw resampled points + a separately-computed 2D bisector is what puts the
  // car exactly on the rendered surface (grounded, no sideways drift on
  // curves) with a true analytic tangent for heading instead of an
  // angle-interpolated approximation between two nearby path vertices.
  const { curve: roadCurve, length: roadCurveLength } = useMemo(() => buildRoadCurve(road), [road]);
  const gltfs = useGLTF(CAR_MODELS);

  const vehicles = useMemo(() => vehiclesAt(sim, simTime), [sim, simTime]);

  const activeConflicts = useMemo(() => {
    if (!sim) return [];
    return sim.conflicts.filter((c) => Math.abs(c.t - simTime) < 0.9);
  }, [sim, simTime]);

  return (
    <group>
      {vehicles.map((v) => {
        // Sample the SAME curve object Road.tsx renders the asphalt from, at
        // this vehicle's actual arc length — not the backend's raw straight-
        // chord lookup, and not a separately re-derived 2D approximation — so
        // the car sits exactly on the rendered surface (correct elevation, no
        // sideways drift) with a true analytic tangent for heading instead of
        // one linearly interpolated between two nearby path vertices.
        const cp = sampleRoadCurveAt(roadCurve, roadCurveLength, v.s);
        // binormal is the exact same cross(tangent, up) direction Road.tsx
        // offsets its edge lines/lane markings along and Infrastructure.tsx
        // anchors guardrails/lamps to — using it here (instead of a separately
        // computed perpendicular()) is what keeps a "centered" lane offset
        // actually centered on the rendered lane, curves included.
        const wx = cp.point.x + cp.binormal.x * v.lane_offset_m;
        const wy = cp.point.y + cp.binormal.y * v.lane_offset_m;
        const wz = cp.point.z + cp.binormal.z * v.lane_offset_m;
        // cp.heading uses the identical atan2(tangent.z, tangent.x) convention
        // buildPath's heading did (see geometryUtils' CurvePoint doc) — for a
        // +Z-forward model this is still the complementary angle, pi/2 - heading.
        const headingRad = Math.PI / 2 - cp.heading;
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
        const cp = sampleRoadCurveAt(roadCurve, roadCurveLength, c.s);
        const wx = cp.point.x, wy = cp.point.y, wz = cp.point.z;
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
