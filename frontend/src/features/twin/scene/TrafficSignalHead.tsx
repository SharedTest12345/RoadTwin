import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Real cycle: matches traffic_sim.py's `cycle = 30.0` / `phase > 18.0`
// exactly, so the light shown here is never out of sync with the physics
// that actually stops vehicles.
export const SIGNAL_CYCLE_S = 30;
// Real US signal sequence is green -> yellow -> red -> green (no amber
// warning before green). The yellow window doubles as a "red is coming"
// anticipation (real drivers get exactly this warning); the red->green
// transition is shown 3s early the same way a driver already sees cross-
// traffic stopped before their own light visibly changes.
const GREEN_TO_YELLOW_S = 15;
const YELLOW_TO_RED_S = 18; // matches the backend's real red boundary exactly
const RED_TO_GREEN_S = 27; // 3s before the backend's real wrap to green

export type SignalState = "green" | "yellow" | "red";

export function phaseToSignalState(phase: number): SignalState {
  if (phase < GREEN_TO_YELLOW_S) return "green";
  if (phase < YELLOW_TO_RED_S) return "yellow";
  if (phase < RED_TO_GREEN_S) return "red";
  return "green";
}

const HOUSING_W = 0.5, HOUSING_H = 1.35, HOUSING_D = 0.32;
const LAMP_R = 0.15;
const LAMP_Y = [0.42, 0, -0.42]; // red top, yellow middle, green bottom

const LAMP_COLORS: Record<SignalState, { dim: string; lit: string }> = {
  red: { dim: "#3a1414", lit: "#ff2f2f" },
  yellow: { dim: "#3a2e10", lit: "#ffcc33" },
  green: { dim: "#123018", lit: "#22c55e" },
};

function setLamp(mesh: THREE.Mesh | null, on: boolean, key: SignalState) {
  if (!mesh) return;
  const mat = mesh.material as THREE.MeshStandardMaterial;
  const c = LAMP_COLORS[key];
  mat.color.set(on ? c.lit : c.dim);
  mat.emissive.set(on ? c.lit : "#000000");
  mat.emissiveIntensity = on ? 5 : 0;
}

/** A real 3-lamp traffic signal head (dark housing, red/yellow/green lamps —
 * only the active one lit) instead of a single color-swapping sphere.
 * `getPhase` is called every frame and must return seconds within
 * SIGNAL_CYCLE_S; callers own how that phase is derived (simTime + this
 * signal's own arc-length position for the physics-synced main crossing
 * light, or a simple decorative clock-based phase for a side-road junction)
 * so this component only owns rendering, not timing policy. Assumes it's
 * placed inside an already positioned/rotated parent group, same as every
 * other roadside prop in this scene. `getPhase` receives the R3F render
 * clock's own elapsedTime (in case a purely decorative caller wants it) but
 * can ignore it entirely — the physics-synced main crossing light reads
 * simTime from the store instead, since that's a simulation clock (pauses/
 * scrubs/speeds up with playback), not the render clock. */
export function TrafficSignalHead({ getPhase, scale = 1 }: { getPhase: (elapsedTime: number) => number; scale?: number }) {
  const redRef = useRef<THREE.Mesh>(null);
  const yellowRef = useRef<THREE.Mesh>(null);
  const greenRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const phase = getPhase(clock.elapsedTime);
    const state = phaseToSignalState(((phase % SIGNAL_CYCLE_S) + SIGNAL_CYCLE_S) % SIGNAL_CYCLE_S);
    setLamp(redRef.current, state === "red", "red");
    setLamp(yellowRef.current, state === "yellow", "yellow");
    setLamp(greenRef.current, state === "green", "green");
  });

  return (
    <group scale={scale}>
      <mesh castShadow>
        <boxGeometry args={[HOUSING_W, HOUSING_H, HOUSING_D]} />
        <meshStandardMaterial color="#16181c" roughness={0.55} metalness={0.35} />
      </mesh>
      {/* Small visors above each lamp — a flat roof-like shade, standard on a
          real signal head, breaks up the housing's otherwise flat front face. */}
      {LAMP_Y.map((y, i) => (
        <mesh key={`visor-${i}`} position={[0, y + LAMP_R * 0.9, HOUSING_D / 2 + 0.04]} rotation={[-0.5, 0, 0]}>
          <boxGeometry args={[HOUSING_W * 0.72, 0.03, 0.14]} />
          <meshStandardMaterial color="#101114" roughness={0.6} />
        </mesh>
      ))}
      <mesh ref={redRef} position={[0, LAMP_Y[0], HOUSING_D / 2 + 0.01]}>
        <circleGeometry args={[LAMP_R, 16]} />
        <meshStandardMaterial color="#3a1414" roughness={0.4} toneMapped={false} />
      </mesh>
      <mesh ref={yellowRef} position={[0, LAMP_Y[1], HOUSING_D / 2 + 0.01]}>
        <circleGeometry args={[LAMP_R, 16]} />
        <meshStandardMaterial color="#3a2e10" roughness={0.4} toneMapped={false} />
      </mesh>
      <mesh ref={greenRef} position={[0, LAMP_Y[2], HOUSING_D / 2 + 0.01]}>
        <circleGeometry args={[LAMP_R, 16]} />
        <meshStandardMaterial color="#123018" roughness={0.4} toneMapped={false} />
      </mesh>
    </group>
  );
}
