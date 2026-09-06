import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Road } from "../../types";
import { buildPath, toWorld } from "../../three/geometryUtils";

interface Props {
  road: Road | null;
  flyTrigger: number;
}

const FLY_DURATION = 2.6;

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

export function CameraRig({ road, flyTrigger }: Props) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const [flying, setFlying] = useState(false);
  const startPos = useRef(new THREE.Vector3());
  const endPos = useRef(new THREE.Vector3());
  const endTarget = useRef(new THREE.Vector3());
  const overviewPos = useRef(new THREE.Vector3());
  const elapsed = useRef(0);

  useEffect(() => {
    if (!road) return;
    const points = buildPath(road);
    if (points.length === 0) return;

    // Fit-to-bounds camera: frame the road's whole bounding box from a fixed 3/4
    // elevated angle, at a distance proportional to the box diagonal. This is what
    // replaced a heading-relative "chase cam" that looked great on short straight
    // roads but foreshortened into an unreadable dark slab on long/winding/steep
    // ones (a grazing near-level view of the road ribbon or cliff face) — framing
    // derived from the actual extent of the geometry can't point at empty space.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    const worldPts = points.map((p) => {
      const w = toWorld(p.x, p.y, p.elev);
      minX = Math.min(minX, w[0]); maxX = Math.max(maxX, w[0]);
      minY = Math.min(minY, w[1]); maxY = Math.max(maxY, w[1]);
      minZ = Math.min(minZ, w[2]); maxZ = Math.max(maxZ, w[2]);
      return w;
    });
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const diag = Math.max(40, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ));

    // Approach from a consistent 3/4 angle (not purely behind the start heading),
    // biased toward the first third of the road so the initial curve reads clearly.
    const focus = worldPts[Math.max(1, Math.min(worldPts.length - 1, Math.floor(worldPts.length * 0.3)))];
    // Framing the WHOLE bounding box meant a 600-900m road was fit to the screen,
    // which puts the camera ~500 units out — at a 45 deg fov that renders a 7m
    // carriageway about two pixels wide, so the "digital twin" read as a thread.
    // Clamp to a hero distance instead: close enough that the road, its markings,
    // guardrail and vehicles are legible, and let the user orbit out if they want
    // the whole extent. The eye-height factor is lowered too (0.75 -> 0.45) for a
    // road-level 3/4 view rather than a near-plan one.
    const dist = Math.max(70, Math.min(190, diag * 0.5));
    const bx = focus[0] - dist * 0.68;
    const bz = focus[2] + dist * 0.68;
    // Eye height is what sets the pitch, and the pitch is what decides whether you
    // see a road in a landscape or a map. At the old 0.75 factor (with a target
    // lifted by diag*0.03) the settled shot looked ~20 deg down with the horizon
    // pushed off the top of a 45 deg frame — no sky, and the road flattened into a
    // thread on a green field. 0.28 against a near-flat target lands about 15 deg:
    // curvature still reads, horizon and sky stay in frame.
    const by = focus[1] + dist * 0.28;

    overviewPos.current.set(cx, Math.min(diag * 1.3, 520), cz + diag * 0.3);
    endPos.current.set(bx, by, bz);
    endTarget.current.set(focus[0], focus[1] + 3, focus[2]);

    camera.position.copy(overviewPos.current);
    camera.lookAt(cx, cy, cz);
    startPos.current.copy(overviewPos.current);
    elapsed.current = 0;
    setFlying(true);
    if (controlsRef.current) controlsRef.current.enabled = false;
  }, [flyTrigger, road, camera]);

  useFrame((_, delta) => {
    if (!flying) return;
    elapsed.current += delta;
    const t = Math.min(1, elapsed.current / FLY_DURATION);
    const e = easeOutCubic(t);
    camera.position.lerpVectors(startPos.current, endPos.current, e);
    const lookTarget = new THREE.Vector3().lerpVectors(overviewPos.current, endTarget.current, e);
    camera.lookAt(lookTarget);
    if (controlsRef.current) {
      controlsRef.current.target.lerpVectors(overviewPos.current, endTarget.current, e);
    }
    if (t >= 1) {
      setFlying(false);
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
        controlsRef.current.target.copy(endTarget.current);
        controlsRef.current.update();
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={!flying}
      enableDamping
      dampingFactor={0.08}
      minDistance={12}
      maxDistance={700}
      maxPolarAngle={Math.PI * 0.49}
    />
  );
}
