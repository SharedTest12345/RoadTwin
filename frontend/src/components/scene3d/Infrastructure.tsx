import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useGLTF, Clone } from "@react-three/drei";
import * as THREE from "three";
import type { Road } from "../../types";
import { buildPath, toWorld, perpendicular, sampleAlongPath } from "../../three/geometryUtils";
import { STREETLIGHT_MODEL, GUARDRAIL_MODEL, WARNING_SIGN_MODEL, STOP_SIGN_MODEL, CONE_MODEL } from "../../three/propModels";

interface Props {
  road: Road;
  guardrailActive: boolean;
  lightingActive: boolean;
  sidewalkActive: boolean;
  crossingActive: boolean;
  signalActive: boolean;
}

// Real Kenney models (~1 unit = 1m) rather than procedural rails/cylinders/octahedra.
const GUARDRAIL_SCALE = 4.5;
const STREETLIGHT_SCALE = 1.3;
const WARNING_SIGN_SCALE = 1.1;
const STOP_SIGN_SCALE = 1.1;
const CONE_SCALE = 6;
// fenceStraight's long axis is local +X (pivot at one end), not +Z like the
// road/vehicle convention, so it needs a quarter-turn to line up with heading.
const GUARDRAIL_ROT_OFFSET = Math.PI / 2;

export function Infrastructure({ road, guardrailActive, lightingActive, sidewalkActive, crossingActive, signalActive }: Props) {
  const points = useMemo(() => buildPath(road), [road]);
  const halfWidth = Math.max(2, road.features.lanes) * 1.7;

  const guardrailGltf = useGLTF(GUARDRAIL_MODEL);
  const streetlightGltf = useGLTF(STREETLIGHT_MODEL);
  const warningGltf = useGLTF(WARNING_SIGN_MODEL);
  const stopSignGltf = useGLTF(STOP_SIGN_MODEL);
  const coneGltf = useGLTF(CONE_MODEL);

  // fenceStraight.gltf was exported from a larger scene without re-baking to
  // origin: its one root node carries a translation of ~(5, 0, -2.7), so cloning
  // guardrailGltf.scene directly placed the actual mesh several meters away from
  // where <Clone position={...}> put the group — it looked completely invisible
  // because it was rendering off to the side of the road, not at the road edge.
  const guardrailScene = useMemo(() => {
    const scene = guardrailGltf.scene.clone(true);
    scene.children.forEach((child) => child.position.set(0, 0, 0));
    return scene;
  }, [guardrailGltf]);

  const guardrailPlacements = useMemo(() => {
    if (!guardrailActive || points.length < 2) return [];
    const out: { pos: THREE.Vector3; rotY: number }[] = [];
    const segmentLen = GUARDRAIL_SCALE; // fenceStraight is 1 unit long before scale
    const total = points[points.length - 1].s;
    for (let s = 0; s < total; s += segmentLen) {
      const p = sampleAlongPath(points, s);
      const [px, pz] = perpendicular(p.ribbonHeading);
      const [wx, wy, wz] = toWorld(p.x, p.y, p.elev);
      out.push({
        pos: new THREE.Vector3(wx - px * (halfWidth + 0.3), wy, wz - pz * (halfWidth + 0.3)),
        rotY: -p.heading + GUARDRAIL_ROT_OFFSET,
      });
    }
    return out;
  }, [points, halfWidth, guardrailActive]);

  const lampPositions = useMemo(() => {
    if (!lightingActive || points.length < 2) return [];
    const out: { pos: THREE.Vector3; rotY: number }[] = [];
    const spacing = 25; // typical real streetlight spacing, in meters
    const total = points[points.length - 1].s;
    for (let s = 0; s < total; s += spacing) {
      const p = sampleAlongPath(points, s);
      const [px, pz] = perpendicular(p.ribbonHeading);
      const [wx, wy, wz] = toWorld(p.x, p.y, p.elev);
      out.push({ pos: new THREE.Vector3(wx + px * (halfWidth + 2.5), wy, wz + pz * (halfWidth + 2.5)), rotY: -p.heading });
    }
    return out;
  }, [points, halfWidth, lightingActive]);

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
      out.push(new THREE.Vector3(wx - px * (halfWidth + 1.5), wy, wz - pz * (halfWidth + 1.5)));
    }
    return out;
  }, [points, halfWidth, road.features.signal_count, signalActive]);

  // intersections_count includes signalized ones; the remainder are stop-controlled
  // (or fully uncontrolled) and are what risk_engine's uncontrolled_intersections
  // factor actually penalizes, so they get a distinct real stop-sign marker instead
  // of nothing.
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
        pos: new THREE.Vector3(wx + px * (halfWidth + 1.5), wy, wz + pz * (halfWidth + 1.5)),
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

      {lightingActive && lampPositions.map((l, i) => (
        <group key={i} position={l.pos} rotation={[0, l.rotY, 0]}>
          <Clone object={streetlightGltf.scene} scale={STREETLIGHT_SCALE} castShadow />
          <mesh position={[1.6, 6.2, 0]}>
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
          <group key={i} position={[wx - px * (halfWidth + 1), wy, wz - pz * (halfWidth + 1)]}
            onPointerOver={() => setHoveredHazard(i)} onPointerOut={() => setHoveredHazard(null)}>
            <Clone object={warningGltf.scene} scale={hoveredHazard === i ? WARNING_SIGN_SCALE * 1.15 : WARNING_SIGN_SCALE} />
            <Clone object={coneGltf.scene} position={[1.4, 0, 0.6]} scale={CONE_SCALE} />
            <Clone object={coneGltf.scene} position={[1.9, 0, -0.5]} scale={CONE_SCALE} />
            {hoveredHazard === i && (
              <Html position={[0, 2.4, 0]} center distanceFactor={22} style={{ pointerEvents: "none" }}>
                <div className="mono text-[10px] bg-base-900/95 border border-risk-high/60 text-risk-high px-2 py-1 rounded whitespace-nowrap">
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

function CrossingStripes({ point, halfWidth }: { point: ReturnType<typeof buildPath>[number]; halfWidth: number }) {
  const [px, pz] = perpendicular(point.ribbonHeading);
  const [wx, wy, wz] = toWorld(point.x, point.y, point.elev);
  const stripes = 5;
  return (
    <group>
      {Array.from({ length: stripes }).map((_, i) => {
        const t = (i / (stripes - 1) - 0.5) * (halfWidth * 1.7);
        return (
          <mesh key={i} position={[wx - px * t, wy + 0.035, wz - pz * t]}
            rotation={[-Math.PI / 2, 0, Math.atan2(pz, px)]}>
            <planeGeometry args={[0.6, halfWidth * 2]} />
            <meshBasicMaterial color="white" transparent opacity={0.75} />
          </mesh>
        );
      })}
    </group>
  );
}

useGLTF.preload(GUARDRAIL_MODEL);
useGLTF.preload(STREETLIGHT_MODEL);
useGLTF.preload(WARNING_SIGN_MODEL);
useGLTF.preload(STOP_SIGN_MODEL);
useGLTF.preload(CONE_MODEL);
