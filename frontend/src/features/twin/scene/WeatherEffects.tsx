import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WeatherPreset } from "../../../state/store";

const RAIN_COUNT = 1400;
const RAIN_SPREAD = 260; // roads project near their own centroid (see feature_extraction.py's
// ref_lat/ref_lon), so world coordinates for ANY road sit close to origin —
// one fixed-size rain volume centered on origin works for every road without
// needing to track its actual bounding box.
const RAIN_HEIGHT = 140;
const RAIN_FALL_SPEED = 90;

/** Falling rain, visible only in the "rain" weather preset. A plain
 * THREE.Points system — cheap enough to run alongside the rest of the scene,
 * wraps particles back to the top once they pass the ground instead of
 * spawning/despawning (avoids any GC churn in the render loop). */
function Rain() {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(RAIN_COUNT * 3);
    for (let i = 0; i < RAIN_COUNT; i++) {
      arr[i * 3] = (Math.random() - 0.5) * RAIN_SPREAD;
      arr[i * 3 + 1] = Math.random() * RAIN_HEIGHT;
      arr[i * 3 + 2] = (Math.random() - 0.5) * RAIN_SPREAD;
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    const geom = ref.current?.geometry;
    if (!geom) return;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < RAIN_COUNT; i++) {
      let y = pos.getY(i) - RAIN_FALL_SPEED * delta;
      if (y < 0) y += RAIN_HEIGHT;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#aecbe8" size={0.35} transparent opacity={0.55} sizeAttenuation />
    </points>
  );
}

export function WeatherEffects({ preset }: { preset: WeatherPreset }) {
  if (preset === "rain") return <Rain />;
  return null;
}
