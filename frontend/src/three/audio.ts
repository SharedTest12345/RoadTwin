/** Procedurally generated ambient audio — no external asset files, same
 * philosophy as textures.ts's canvas-drawn textures (built at runtime, works
 * fully offline, nothing to fetch). */

export function createNoiseBuffer(ctx: AudioContext, seconds = 3): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.round(ctx.sampleRate * seconds)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
