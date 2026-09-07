import { useEffect, useRef } from "react";
import { useStore } from "../../state/store";
import { createNoiseBuffer } from "../../three/audio";

const RAIN_TARGET_GAIN = 0.32;
const TRAFFIC_TARGET_GAIN = 0.16;
const GAIN_RAMP_S = 1.2;

/** Two procedural ambient layers — rain (filtered noise) and a low
 * traffic/engine drone — gated by the SAME state driving the visuals
 * (weatherPreset, whether the sim is actually playing) rather than a
 * separate, easy-to-drift audio toggle. No external audio files: both
 * layers are synthesized at runtime via Web Audio, same philosophy as
 * textures.ts's canvas-drawn textures.
 *
 * Not an R3F component — Web Audio has nothing to do with WebGL, so this
 * mounts as a plain sibling of <Canvas> in Scene.tsx, not inside it. */
export function SoundManager() {
  const weatherPreset = useStore((s) => s.weatherPreset);
  const simPlaying = useStore((s) => s.simPlaying);
  const sim = useStore((s) => s.sim);
  const audioMuted = useStore((s) => s.audioMuted);

  const ctxRef = useRef<AudioContext | null>(null);
  const rainGainRef = useRef<GainNode | null>(null);
  const trafficGainRef = useRef<GainNode | null>(null);

  // Built once. Browsers start an AudioContext "suspended" until a real user
  // gesture — the pointerdown/keydown listeners below just resume it the
  // first time one happens; nothing here ever calls .resume() on its own,
  // so this never fights the browser's autoplay policy.
  useEffect(() => {
    const AudioCtxCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtxCtor();
    ctxRef.current = ctx;

    const rainSource = ctx.createBufferSource();
    rainSource.buffer = createNoiseBuffer(ctx, 3);
    rainSource.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = "bandpass";
    rainFilter.frequency.value = 3200;
    rainFilter.Q.value = 0.5;
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    rainSource.connect(rainFilter).connect(rainGain).connect(ctx.destination);
    rainSource.start();
    rainGainRef.current = rainGain;

    // Low sawtooth (engine-ish tone) + filtered road noise, mixed into one
    // gain — a simple ambient "traffic is moving" drone rather than per-
    // vehicle engine sounds (dozens of independent spatial sources would be
    // a much bigger, noisier undertaking for a background ambience layer).
    const hum = ctx.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.value = 68;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = "lowpass";
    humFilter.frequency.value = 260;
    const roadNoise = ctx.createBufferSource();
    roadNoise.buffer = createNoiseBuffer(ctx, 3);
    roadNoise.loop = true;
    const roadNoiseFilter = ctx.createBiquadFilter();
    roadNoiseFilter.type = "lowpass";
    roadNoiseFilter.frequency.value = 450;
    const trafficGain = ctx.createGain();
    trafficGain.gain.value = 0;
    hum.connect(humFilter).connect(trafficGain);
    roadNoise.connect(roadNoiseFilter).connect(trafficGain);
    trafficGain.connect(ctx.destination);
    hum.start();
    roadNoise.start();
    trafficGainRef.current = trafficGain;

    const resume = () => { if (ctx.state === "suspended") void ctx.resume(); };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);

    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
      rainSource.stop();
      hum.stop();
      roadNoise.stop();
      void ctx.close();
    };
  }, []);

  useEffect(() => {
    const ctx = ctxRef.current, gain = rainGainRef.current;
    if (!ctx || !gain) return;
    const target = !audioMuted && weatherPreset === "rain" ? RAIN_TARGET_GAIN : 0;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.linearRampToValueAtTime(target, ctx.currentTime + GAIN_RAMP_S);
  }, [weatherPreset, audioMuted]);

  useEffect(() => {
    const ctx = ctxRef.current, gain = trafficGainRef.current;
    if (!ctx || !gain) return;
    const target = !audioMuted && simPlaying && sim ? TRAFFIC_TARGET_GAIN : 0;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.linearRampToValueAtTime(target, ctx.currentTime + GAIN_RAMP_S);
  }, [simPlaying, sim, audioMuted]);

  return null;
}
