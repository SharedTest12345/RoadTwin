import { Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, SMAA } from "@react-three/postprocessing";
import * as THREE from "three";
import { useStore } from "../../state/store";
import { Terrain } from "./Terrain";
import { Road } from "./Road";
import { Scenery } from "./Scenery";
import { Infrastructure } from "./Infrastructure";
import { Vehicles } from "./Vehicles";
import { CameraRig } from "./CameraRig";

// One sun vector shared by the visible <Sky> and the shadow-casting directional
// light — if they drift apart, shadows fall away from where the sun visibly is.
// Placed BEHIND the camera's default approach (CameraRig flies in from -x/+z and
// looks toward +x/-z): with the sun on the +x side the camera stared straight into
// the mie-scatter glare and the top of the frame blew out to flat white.
const SUN_POSITION: [number, number, number] = [-160, 560, 200];

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
      {/* Daylight, not night. The scene was previously lit as a night shot: black
          background, night HDRI, near-black ground/asphalt. Nothing in a road
          scene emits its own light, so everything rendered as a black void with a
          hairline road in it — every terrain/asset/geometry fix underneath was
          invisible. A real sky with a real sun is what makes it read as a place. */}
      <color attach="background" args={["#c2d3e4"]} />
      <Sky sunPosition={SUN_POSITION} turbidity={7} rayleigh={2.6} mieCoefficient={0.004} mieDirectionalG={0.75} />
      {/* Light atmospheric haze in the sky's own horizon color — enough to fade the
          terrain plane's edge into the sky, not enough to grey out the road. */}
      <fogExp2 attach="fog" args={["#c2d3e4", 0.0005]} />
      {/* Outdoor daylight rig: sky-vs-ground hemisphere does the ambient fill (blue
          from above, warm bounce from the ground), the directional is the sun and
          owns the shadows, and only a little flat ambient so shadowed faces keep
          some detail without washing the whole thing out. */}
      <hemisphereLight args={["#b9d6f5", "#7a6f57", 1.15]} />
      <ambientLight intensity={0.3} />
      <directionalLight
        position={SUN_POSITION}
        intensity={2.5}
        color="#fff4e2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-350}
        shadow-camera-right={350}
        shadow-camera-top={350}
        shadow-camera-bottom={-350}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
      />
      <Suspense fallback={null}>
        <SceneContent />
      </Suspense>
      <EffectComposer multisampling={0}>
        <SMAA />
        {/* Tight, selective glow on genuinely bright emissive elements (lights, signals,
            hazard markers) — a wide/low-threshold bloom was washing its color across the
            entire road surface instead of just glowing the strip that emits it. */}
        <Bloom luminanceThreshold={1.0} luminanceSmoothing={0.2} intensity={0.25} mipmapBlur={false} kernelSize={2} />
        {/* Much lighter than the old night-scene vignette — at 0.6 it ate the
            corners of an already-dark frame; in daylight it only needs to keep the
            eye off the terrain plane's far edge. */}
        <Vignette eskil={false} offset={0.3} darkness={0.35} />
      </EffectComposer>
    </Canvas>
  );
}
