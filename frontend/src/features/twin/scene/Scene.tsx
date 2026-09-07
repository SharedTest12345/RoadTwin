import { Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, SMAA } from "@react-three/postprocessing";
import * as THREE from "three";
import { useStore } from "../../../state/store";
import type { WeatherPreset } from "../../../state/store";
import { Terrain } from "./Terrain";
import { Road } from "./Road";
import { Scenery } from "./Scenery";
import { SideRoads } from "./SideRoads";
import { Infrastructure } from "./Infrastructure";
import { Vehicles } from "./Vehicles";
import { Pedestrians } from "./Pedestrians";
import { CameraRig } from "./CameraRig";
import { WeatherEffects } from "./WeatherEffects";
import { SoundManager } from "../SoundManager";

// One sun vector shared by the visible <Sky> and the shadow-casting directional
// light — if they drift apart, shadows fall away from where the sun visibly is.
// Placed BEHIND the camera's default approach (CameraRig flies in from -x/+z and
// looks toward +x/-z): with the sun on the +x side the camera would stare
// straight into the mie-scatter glare and the top of the frame blows out white.
const SUN_POSITION: [number, number, number] = [-160, 560, 200];

interface WeatherRig {
  background: string;
  showSky: boolean;
  skyTurbidity?: number;
  skyRayleigh?: number;
  fogColor: string;
  fogDensity: number;
  hemisphere: [string, string, number];
  ambient: number;
  sunColor: string;
  sunIntensity: number;
}

// Four atmospheric presets — each is a real lighting/sky/fog change (not a
// filter over the same render), so the same road genuinely reads differently
// at night / in rain / in fog rather than just tinting one fixed shot.
// Fog density needed a real second look: exp2 fog attenuation is
// exp(-(density*distance)^2), and at the previous clear_day value (0.0005)
// even the camera's ~500-unit overview distance only gives (0.0005*500)^2 =
// 0.0625 — barely any attenuation at all, so the "fade the terrain edge into
// the sky" the comment always intended was effectively not happening. These
// values are retuned so the effect is actually visible at the distances each
// camera preset actually uses, scaling up per preset the same way a real
// reference implementation's atmosphere does (dense fog should genuinely
// limit visibility at range, not just tint the color).
const WEATHER: Record<WeatherPreset, WeatherRig> = {
  clear_day: {
    background: "#c2d3e4", showSky: true, skyTurbidity: 3, skyRayleigh: 1,
    fogColor: "#c2d3e4", fogDensity: 0.0012,
    hemisphere: ["#b9d6f5", "#7a6f57", 1.15], ambient: 0.3,
    sunColor: "#fff4e2", sunIntensity: 2.5,
  },
  night: {
    background: "#05070d", showSky: false,
    fogColor: "#05070d", fogDensity: 0.002,
    hemisphere: ["#1a2a4a", "#05050a", 0.35], ambient: 0.12,
    sunColor: "#c7d8ff", sunIntensity: 0.35,
  },
  rain: {
    background: "#7d8a96", showSky: false,
    fogColor: "#7d8a96", fogDensity: 0.004,
    hemisphere: ["#8a97a3", "#5a5348", 0.7], ambient: 0.35,
    sunColor: "#c9d3da", sunIntensity: 0.9,
  },
  fog: {
    background: "#b8bfc4", showSky: false,
    fogColor: "#b8bfc4", fogDensity: 0.01,
    hemisphere: ["#b0b6ba", "#8a8478", 0.9], ambient: 0.5,
    sunColor: "#d8dcdf", sunIntensity: 0.8,
  },
};

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
  const cameraPreset = useStore((s) => s.cameraPreset);
  const cameraPresetTrigger = useStore((s) => s.cameraPresetTrigger);

  if (!road) return null;

  const guardrailActive = road.guardrail_active || !!twinOverrides.guardrail_active;
  const lightingActive = road.features.has_lighting || !!twinOverrides.lighting_active;
  const sidewalkActive = road.features.has_sidewalk || !!twinOverrides.sidewalk_active;
  const crossingActive = road.features.crossing_density_per_km > 0 || !!twinOverrides.crossing_active;
  const signalActive = road.features.signal_count > 0 || !!twinOverrides.signal_active;
  const speedBumpsActive = !!twinOverrides.speed_bumps_active;

  return (
    <>
      <SimClock />
      <CameraRig road={road} flyTrigger={flyTrigger} cameraPreset={cameraPreset} cameraPresetTrigger={cameraPresetTrigger} sim={sim} simTime={simTime} />
      <Terrain road={road} />
      <Road road={road} sidewalkActive={sidewalkActive} />
      <Scenery road={road} />
      <SideRoads road={road} />
      <Infrastructure
        road={road}
        sim={sim}
        guardrailActive={guardrailActive}
        lightingActive={lightingActive}
        sidewalkActive={sidewalkActive}
        crossingActive={crossingActive}
        signalActive={signalActive}
        speedBumpsActive={speedBumpsActive}
      />
      <Vehicles road={road} sim={sim} simTime={simTime} />
      <Pedestrians road={road} sim={sim} simTime={simTime} />
    </>
  );
}

export function TwinScene() {
  const weatherPreset = useStore((s) => s.weatherPreset);
  const road = useStore((s) => s.road);
  const w = WEATHER[weatherPreset];

  return (
    <>
      {/* Web Audio has nothing to do with WebGL — mounted as a Canvas sibling,
          not a child, so it isn't tied to the R3F render loop. */}
      {road && <SoundManager />}
      <Canvas
        shadows="soft"
        camera={{ fov: 45, near: 0.5, far: 4000, position: [0, 220, 260] }}
        gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1, antialias: true }}
      >
        {/* Daylight scene: a real sky with a real sun is what makes it read as a
            place rather than a hairline road floating in a void. Low
            turbidity/rayleigh keeps the sky dome legibly blue at any camera
            angle instead of clipping to white under ACES tonemapping. Night/
            rain/fog skip the atmospheric-scattering <Sky> (it's inherently a
            clear-sky-daylight model) for a flat overcast/dark color instead. */}
        <color attach="background" args={[w.background]} />
        {w.showSky && (
          <Sky sunPosition={SUN_POSITION} turbidity={w.skyTurbidity} rayleigh={w.skyRayleigh} mieCoefficient={0.003} mieDirectionalG={0.8} />
        )}
        <fogExp2 attach="fog" args={[w.fogColor, w.fogDensity]} />
        <hemisphereLight args={w.hemisphere} />
        <ambientLight intensity={w.ambient} />
        <directionalLight
          position={SUN_POSITION}
          intensity={w.sunIntensity}
          color={w.sunColor}
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
          {road && <WeatherEffects preset={weatherPreset} road={road} />}
        </Suspense>
        <EffectComposer multisampling={0}>
          <SMAA />
          {/* Tight, selective glow on genuinely bright emissive elements (lights,
              signals, hazard markers, vehicle tail-lights) rather than a wide/
              low-threshold bloom that washes color across the whole road
              surface — this is what makes streetlights/brake-lights actually
              read as light sources once the night preset darkens everything
              else around them. */}
          <Bloom luminanceThreshold={1.0} luminanceSmoothing={0.2} intensity={0.25} mipmapBlur={false} kernelSize={2} />
          <Vignette eskil={false} offset={0.3} darkness={0.35} />
        </EffectComposer>
      </Canvas>
    </>
  );
}
