import type { SimResult, VehicleFrame } from "../types";

/** Binary-searches sim.frames for the pair bracketing time `t`, plus the
 * interpolation fraction between them. Shared by anything that needs "where
 * is every vehicle right now" — Vehicles.tsx (rendering) and CameraRig.tsx
 * (driver POV tracking) — so there's exactly one implementation of "current
 * sim time -> bracketing frames" instead of two that could drift apart. */
export function findFrameBounds(sim: SimResult, t: number) {
  const frames = sim.frames;
  if (frames.length === 0) return null;
  if (t <= frames[0].t) return { a: frames[0], b: frames[0], f: 0 };
  if (t >= frames[frames.length - 1].t) return { a: frames[frames.length - 1], b: frames[frames.length - 1], f: 0 };
  let lo = 0, hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = frames[lo], b = frames[hi];
  const f = (t - a.t) / Math.max(b.t - a.t, 1e-6);
  return { a, b, f };
}

// `s` (arc length along the road) and `lane_offset_m` interpolate as plain
// scalars — no wraparound to worry about the way raw heading degrees had, and
// re-deriving position/heading fresh from the smooth curve at the interpolated
// `s` means callers don't need to reconstruct a heading at all.
export function interpolateVehicles(a: VehicleFrame[], b: VehicleFrame[], f: number): VehicleFrame[] {
  const bMap = new Map(b.map((v) => [v.id, v]));
  const out: VehicleFrame[] = [];
  for (const va of a) {
    const vb = bMap.get(va.id);
    if (!vb) continue;
    out.push({
      id: va.id, lane: va.lane, braking: vb.braking, lane_offset_m: vb.lane_offset_m,
      s: va.s + (vb.s - va.s) * f,
      v_ms: va.v_ms + (vb.v_ms - va.v_ms) * f,
    });
  }
  return out;
}

/** Vehicles currently active (present in the frame) at sim time `t`, live-
 * interpolated between the two bracketing backend frames. */
export function vehiclesAt(sim: SimResult | null, t: number): VehicleFrame[] {
  if (!sim) return [];
  const bounds = findFrameBounds(sim, t);
  if (!bounds) return [];
  return interpolateVehicles(bounds.a.vehicles, bounds.b.vehicles, bounds.f);
}
