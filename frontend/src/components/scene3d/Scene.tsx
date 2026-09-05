import { Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Stars, Environment } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, SMAA } from "@react-three/postprocessing";
import * as THREE from "three";
import { useStore } from "../../state/store";
import { Terrain } from "./Terrain";
import { Road } from "./Road";
import { Scenery } from "./Scenery";
import { Infrastructure } from "./Infrastructure";
import { Vehicles } from "./Vehicles";
import { CameraRig } from "./CameraRig";

function SimClock() {
  const tickSim = useStore((s) => s.tickSim);
  useFrame((_, delta) => tickSim(Math.min(delta, 0.1)));
  return null;
}

function SceneContent() {
  const road = useStore((s) => s.road);
  const sim = useStore((s) => s.sim);
  const simTime = useStore((s) => s.simTime);
  const flyTrigger = useStore((s) => s.flyTrigger);
  const twinOverrides = useStore((s) => s.twinOverrides);

  if (!road) return null;

  const guardrailActive = road.guardrail_active || !!twinOverrides.guardrail_active;
  const lightingActive = road.features.has_lighting || !!twinOverrides.lighting_active;
  const sidewalkActive = road.features.has_sidewalk || !!twinOverrides.sidewalk_active;
  const crossingActive = road.features.crossing_density_per_km > 0 || !!twinOverrides.crossing_active;
  const signalActive = road.features.signal_count > 0 || !!twinOverrides.signal_active;

  return (
    <>
      <SimClock />
      <CameraRig road={road} flyTrigger={flyTrigger} />
      <Terrain road={road} />
      <Road road={road} />
      <Scenery road={road} />
      <Infrastructure
        road={road}
        guardrailActive={guardrailActive}
        lightingActive={lightingActive}
        sidewalkActive={sidewalkActive}
        crossingActive={crossingActive}
        signalActive={signalActive}
      />
      <Vehicles road={road} sim={sim} simTime={simTime} />
    </>
  );
}

export function Scene3D() {
  return (
    <Canvas
      shadows
      camera={{ fov: 45, near: 0.5, far: 4000, position: [0, 220, 260] }}
      gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1, antialias: true }}
    >
      <color attach="background" args={["#090d16"]} />
      {/* Exponential-squared fog matches the background exactly and thickens
          gradually with distance — this (plus the enlarged terrain in Terrain.tsx)
          is what hides the ground plane's edge instead of a flat linear cutoff. */}
      <fogExp2 attach="fog" args={["#090d16", 0.00075]} />
      {/* A dramatic single "sun" carries the scene, but ambient/hemisphere still
          need enough fill that terrain/props facing away from it stay a dark,
          READABLE gray rather than crushing to pure black — at ~0.1 they were
          indistinguishable from the background, losing the whole ground plane
          and any tree/building not directly front-lit. */}
      <ambientLight intensity={0.5} />
      <hemisphereLight args={["#4a5a6c", "#0a0e14", 0.55]} />
      <directionalLight
        position={[220, 320, 140]}
        intensity={2.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-350}
        shadow-camera-right={350}
        shadow-camera-top={350}
        shadow-camera-bottom={-350}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
      />
      {/* Self-hosted (public/hdri/night.hdr, CC0 via Poly Haven) rather than drei's
          preset, which fetches from a remote CDN at runtime — this keeps the app
          working fully offline once the page itself has loaded. */}
      <Environment files="/hdri/night.hdr" environmentIntensity={0.3} resolution={128} />
      <Stars radius={800} depth={80} count={2500} factor={4} fade speed={0.4} />
      <Suspense fallback={null}>
        <SceneContent />
      </Suspense>
      <EffectComposer multisampling={0}>
        <SMAA />
        {/* Tight, selective glow on genuinely bright emissive elements (lights, signals,
            hazard markers) — a wide/low-threshold bloom was washing its color across the
            entire road surface instead of just glowing the strip that emits it. */}
        <Bloom luminanceThreshold={0.9} luminanceSmoothing={0.15} intensity={0.4} mipmapBlur={false} kernelSize={2} />
        <Vignette eskil={false} offset={0.15} darkness={0.6} />
      </EffectComposer>
    </Canvas>
  );
}
