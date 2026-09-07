import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Road, SimResult } from "../../../types";
import type { CameraPreset } from "../../../state/store";
import { buildPath, buildRoadCurve, sampleRoadCurveAt, toWorld, perpendicular, sampleAlongPath } from "../../../three/geometryUtils";
import { vehiclesAt } from "../../../lib/simFrames";
import { FreeFlyControls } from "./FreeFlyControls";

interface Props {
  road: Road | null;
  flyTrigger: number;
  cameraPreset: CameraPreset;
  cameraPresetTrigger: number;
  sim: SimResult | null;
  simTime: number;
}

const FLY_DURATION = 2.6;
// After the fly-in settles and the user hasn't touched the camera for this
// long, drift into a slow cinematic orbit — a demo left on-screen shouldn't
// sit dead-static. Any drag/scroll/pinch cancels it immediately.
const IDLE_ORBIT_DELAY_MS = 5000;
const IDLE_ORBIT_SPEED = 0.35;

// Driver POV: third-person chase cam riding along BEHIND and above the
// followed vehicle's OWN live (s, lane_offset_m), looking at the car — not
// a first-person eye INSIDE it. Both the camera's own position and its
// look-at target are sampled fresh off the followed vehicle's live s every
// frame, instead of a fixed point 35% along the road that never actually
// followed any car.
const CHASE_DISTANCE_M = 9; // how far behind the car, along the road, the camera trails
const CHASE_HEIGHT_M = 3.4;
const CHASE_LOOK_HEIGHT_M = 1.3; // aims roughly at the car's roof/cabin, not its wheels

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

type Points = ReturnType<typeof buildPath>;

interface Framing {
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

/** Fit-to-bounds "hero" shot: frames the road's whole bounding box from a
 * fixed 3/4 elevated angle, at a distance proportional to the box diagonal —
 * reads correctly on long/winding/steep roads unlike a heading-relative
 * chase cam, which foreshortens into an unreadable dark slab on those. */
function overviewFraming(points: Points): Framing {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  const worldPts = points.map((p) => {
    const w = toWorld(p.x, p.y, p.elev);
    minX = Math.min(minX, w[0]); maxX = Math.max(maxX, w[0]);
    minY = Math.min(minY, w[1]); maxY = Math.max(maxY, w[1]);
    minZ = Math.min(minZ, w[2]); maxZ = Math.max(maxZ, w[2]);
    return w;
  });
  const diag = Math.max(40, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ));

  // Approach from a consistent 3/4 angle, biased toward the first third of
  // the road so the initial curve reads clearly.
  const focus = worldPts[Math.max(1, Math.min(worldPts.length - 1, Math.floor(worldPts.length * 0.3)))];
  // Clamp to a hero distance rather than fitting the whole extent: close
  // enough that the road, markings, guardrail and vehicles are legible, and
  // the user can orbit out for the full extent if they want. A wide hairpin's
  // bounding-box diagonal can be large even though the carriageway itself is
  // narrow — the old 190 upper clamp backed the camera off far enough on
  // those that the road read as a thin, distant ribbon with everything on it
  // looking tiny. 140/0.42 keeps the frame noticeably tighter across the
  // board (confirmed by comparison screenshot — a closer default shot is
  // what actually reads as "big" here, not the underlying object scale).
  const dist = Math.max(65, Math.min(140, diag * 0.42));
  const bx = focus[0] - dist * 0.68;
  const bz = focus[2] + dist * 0.68;
  const by = focus[1] + dist * 0.28;

  return {
    pos: new THREE.Vector3(bx, by, bz),
    target: new THREE.Vector3(focus[0], focus[1] + 3, focus[2]),
  };
}

/** Fixed elevated corner-mounted overlook, angled down at the road — a
 * traffic/security-camera read on the corridor rather than a driver's. */
function cctvFraming(points: Points): Framing {
  const total = points[points.length - 1].s;
  const p = sampleAlongPath(points, total * 0.5);
  const [px, pz] = perpendicular(p.ribbonHeading);
  const [wx, wy, wz] = toWorld(p.x, p.y, p.elev);
  return {
    pos: new THREE.Vector3(wx + px * 16, wy + 16, wz + pz * 16),
    target: new THREE.Vector3(wx, wy + 2, wz),
  };
}

/** Close inspection framing at the road's own flagged hazard vertex (sharp
 * turn without a guardrail — the same point Infrastructure.tsx marks with a
 * warning sign). Falls back to the road's midpoint if it has no hazard. */
function hazardInspectFraming(points: Points): Framing {
  const hazard = points.find((p) => p.hazard) ?? points[Math.floor(points.length / 2)];
  const [px, pz] = perpendicular(hazard.ribbonHeading);
  const [wx, wy, wz] = toWorld(hazard.x, hazard.y, hazard.elev);
  return {
    pos: new THREE.Vector3(wx - px * 14, wy + 10, wz - pz * 14),
    target: new THREE.Vector3(wx, wy + 1.5, wz),
  };
}

function computeFraming(points: Points, preset: CameraPreset): Framing {
  switch (preset) {
    case "cctv": return cctvFraming(points);
    case "hazard_inspect": return hazardInspectFraming(points);
    default: return overviewFraming(points);
  }
}

export function CameraRig({ road, flyTrigger, cameraPreset, cameraPresetTrigger, sim, simTime }: Props) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const [flying, setFlying] = useState(false);
  const startPos = useRef(new THREE.Vector3());
  const startTarget = useRef(new THREE.Vector3());
  const endPos = useRef(new THREE.Vector3());
  const endTarget = useRef(new THREE.Vector3());
  const elapsed = useRef(0);
  const lastInteraction = useRef(0);
  const lastFlyTrigger = useRef(flyTrigger);

  // Same shared curve Vehicles.tsx renders cars against — the followed
  // vehicle's eye position has to land on the exact same rendered road
  // surface, not a separately-derived approximation.
  const roadCurveInfo = useMemo(() => (road ? buildRoadCurve(road) : null), [road]);
  const currentVehicles = useMemo(() => vehiclesAt(sim, simTime), [sim, simTime]);
  // Kept in sync for the keydown handler below, which is bound once per
  // cameraPreset change (not every frame) and needs the LATEST vehicle list
  // at whatever moment the user actually presses a key, not a stale one
  // captured when the listener was first attached.
  const vehiclesRef = useRef(currentVehicles);
  useEffect(() => { vehiclesRef.current = currentVehicles; }, [currentVehicles]);

  // Which vehicle id driver POV is currently riding with. null = "not
  // decided yet" — the useFrame loop below picks the latest-born (highest
  // id) active vehicle the first time it sees this unset, and again
  // whenever the previously-followed vehicle disappears (finished the
  // route). Arrow Up/Down cycle it manually; see the keydown effect below.
  const followedVehicleId = useRef<number | null>(null);

  useEffect(() => {
    if (!road) return;
    const points = buildPath(road);
    if (points.length === 0) return;

    const isNewRoad = lastFlyTrigger.current !== flyTrigger;
    lastFlyTrigger.current = flyTrigger;

    if (cameraPreset === "free_fly") {
      // No fixed framing to fly to — FreeFlyControls picks up from wherever
      // the camera already is/faces, so this preset just has to stop any
      // in-progress fly-in and get out of the way.
      setFlying(false);
      return;
    }

    if (cameraPreset === "driver_pov") {
      // Fully programmatic every frame (see the useFrame loop below) — no
      // static end-framing to fly to, and no fly-in transition (an instant
      // cut into the driver's seat, same as free_fly just handing off
      // immediately). Un-set the followed vehicle so entering/re-entering
      // this mode (or a new road loading) always re-picks the latest-born
      // car fresh, rather than sticking with one from a previous visit.
      followedVehicleId.current = null;
      setFlying(false);
      return;
    }

    const framing = computeFraming(points, cameraPreset);
    endPos.current.copy(framing.pos);
    endTarget.current.copy(framing.target);

    if (isNewRoad) {
      // Dramatic sweep down from a wide overhead vantage — only for an
      // actually-new road; switching camera presets on the SAME road starts
      // from wherever the camera currently is instead of re-zooming out.
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of points) {
        const [wx, , wz] = toWorld(p.x, p.y, 0);
        minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
        minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
      }
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      const diag = Math.max(40, Math.hypot(maxX - minX, maxZ - minZ));
      startPos.current.set(cx, Math.min(diag * 1.3, 520), cz + diag * 0.3);
      startTarget.current.set(cx, 0, cz);
    } else {
      startPos.current.copy(camera.position);
      startTarget.current.copy(controlsRef.current?.target ?? endTarget.current);
    }

    camera.position.copy(startPos.current);
    camera.lookAt(startTarget.current);
    elapsed.current = 0;
    lastInteraction.current = performance.now();
    setFlying(true);
    if (controlsRef.current) controlsRef.current.enabled = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTrigger, cameraPresetTrigger, road, camera]);

  // Arrow Up/Down cycle through currently-active vehicles, ordered newest
  // (highest id, position 0) to oldest — Up moves toward a newer car, Down
  // toward an older one. Only bound while driver_pov is actually active, so
  // arrow keys behave normally (page scroll etc) in every other mode.
  useEffect(() => {
    if (cameraPreset !== "driver_pov") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const active = vehiclesRef.current;
      if (active.length === 0) return;
      const sorted = [...active].sort((a, b) => b.id - a.id);
      const curIdx = sorted.findIndex((v) => v.id === followedVehicleId.current);
      let idx = curIdx === -1 ? 0 : curIdx;
      idx = e.key === "ArrowUp" ? Math.max(0, idx - 1) : Math.min(sorted.length - 1, idx + 1);
      followedVehicleId.current = sorted[idx].id;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cameraPreset]);

  useFrame((_, delta) => {
    if (cameraPreset === "free_fly") return; // FreeFlyControls owns the camera entirely in this mode

    if (cameraPreset === "driver_pov") {
      const active = currentVehicles;
      const curveInfo = roadCurveInfo;
      if (active.length > 0 && curveInfo) {
        const stillActive = followedVehicleId.current != null
          && active.some((v) => v.id === followedVehicleId.current);
        if (!stillActive) {
          // The previously-followed car finished the route (or this is the
          // first frame in this mode) — fall to whichever active car is now
          // the latest-born.
          const latest = active.reduce((m, v) => (v.id > m.id ? v : m), active[0]);
          followedVehicleId.current = latest.id;
        }
        const v = active.find((veh) => veh.id === followedVehicleId.current);
        if (v) {
          const { curve, length } = curveInfo;
          // Camera trails BEHIND the car along the road (lower s), not
          // beside/inside it — a real chase cam, not a fixed point the car
          // happens to be passing.
          const behind = sampleRoadCurveAt(curve, length, Math.max(0, v.s - CHASE_DISTANCE_M));
          const carCp = sampleRoadCurveAt(curve, length, v.s);
          const eye = behind.point.clone()
            .addScaledVector(behind.binormal, v.lane_offset_m)
            .add(new THREE.Vector3(0, CHASE_HEIGHT_M, 0));
          const lookAt = carCp.point.clone()
            .addScaledVector(carCp.binormal, v.lane_offset_m)
            .add(new THREE.Vector3(0, CHASE_LOOK_HEIGHT_M, 0));
          camera.position.copy(eye);
          camera.lookAt(lookAt);
        }
      }
      return;
    }

    if (flying) {
      elapsed.current += delta;
      const t = Math.min(1, elapsed.current / FLY_DURATION);
      const e = easeOutCubic(t);
      camera.position.lerpVectors(startPos.current, endPos.current, e);
      const lookTarget = new THREE.Vector3().lerpVectors(startTarget.current, endTarget.current, e);
      camera.lookAt(lookTarget);
      if (controlsRef.current) {
        controlsRef.current.target.lerpVectors(startTarget.current, endTarget.current, e);
      }
      if (t >= 1) {
        setFlying(false);
        lastInteraction.current = performance.now();
        if (controlsRef.current) {
          controlsRef.current.enabled = true;
          controlsRef.current.target.copy(endTarget.current);
          controlsRef.current.update();
        }
      }
      return;
    }
    if (controlsRef.current) {
      const idleFor = performance.now() - lastInteraction.current;
      controlsRef.current.autoRotate = idleFor > IDLE_ORBIT_DELAY_MS;
    }
  });

  // Only 'start' (fired on user pointerdown/wheel, never on the autoRotate
  // update itself) resets the idle clock — three.js OrbitControls also fires
  // 'change' on every autoRotate tick, which would otherwise reset the timer
  // every frame and make autoRotate flicker on for one frame and immediately
  // back off.
  const markInteraction = () => { lastInteraction.current = performance.now(); };

  if (cameraPreset === "free_fly") return <FreeFlyControls />;
  // Fully programmatic (see the useFrame branch above) — no user-draggable
  // controls to fight the continuous per-frame tracking.
  if (cameraPreset === "driver_pov") return null;

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={!flying}
      enableDamping
      dampingFactor={0.08}
      // No distance/polar-angle limits — the user can zoom/orbit as far and
      // as steeply as they want, including straight overhead or down near the
      // ground. (This reopens the top-down-collapse case a minPolarAngle used
      // to guard against — an explicit tradeoff for full manual control,
      // not an oversight.)
      autoRotateSpeed={IDLE_ORBIT_SPEED}
      onStart={markInteraction}
    />
  );
}
