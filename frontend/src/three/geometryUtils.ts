import * as THREE from "three";
import type { Road } from "../types";

// Single source of truth for risk tiers on the frontend — mirrors backend
// risk_engine.CATEGORY_THRESHOLDS exactly (80/60/40/0 -> CRITICAL/HIGH/MODERATE/LOW).
// Every place that shows a risk badge, dot, or bar color reads from this table
// instead of re-deriving its own thresholds, which is what let the top header
// badge, side panel, and priority map disagree with each other before.
export const RISK_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH: "#f97316",
  MODERATE: "#eab308",
  LOW: "#22c55e",
};

export function riskColor(category: string): string {
  return RISK_COLORS[category] ?? RISK_COLORS.LOW;
}

/** Category label for a raw 0-100 score — must stay byte-identical to the
 * backend's CATEGORY_THRESHOLDS. Used where the frontend only has a number
 * (e.g. priority map rows) and shouldn't invent its own bucketing. */
export function riskCategoryFromScore(score: number): string {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MODERATE";
  return "LOW";
}

/** local_xy (x=east, y=north) meters -> three.js world space (x=x, z=-y, y=elevation) */
export function toWorld(x: number, y: number, elev: number): [number, number, number] {
  return [x, elev, -y];
}

export interface PathPoint {
  x: number;
  y: number;
  elev: number;
  heading: number; // radians, direction of travel (use for rotating props/vehicles)
  // Miter-joined direction for LATERAL offsets (road edges, guardrail/tree/sign
  // placement) — the bisector of the incoming and outgoing segment directions at
  // this vertex, not just the outgoing one. Every ribbon strip in this scene is
  // built by offsetting each centerline point perpendicular to a single heading;
  // using the outgoing-segment heading at both ends of a segment means the two
  // ends of a sharp turn get offset perpendicular to DIFFERENT directions, which
  // pinches/twists the quad between them into a self-intersecting "origami fold"
  // instead of a smooth turn. Same value as `heading` at the path's two endpoints
  // (only one adjacent segment exists there).
  ribbonHeading: number;
  s: number; // cumulative arc length
  hazard: boolean; // sharp turn / cliff-edge hazard at this vertex
}

// Real roads (especially real OSRM-derived ones, which often represent a turn
// with a single sharp-angle vertex instead of the demo catalog's hand-spread
// switchback curves) can have one vertex where the incoming and outgoing segment
// directions differ by 40-90+ degrees. A miter-joined offset direction alone
// (see ribbonHeading below) fixes which way that vertex's edges point, but the
// vertex is still a literal KINK — one point shared by two very differently
// angled quads — which is what actually reads as a paper-fold twist rather than
// a road bending through a curve. Real roads have a curve radius; a resampled
// Catmull-Rom spline through the same points gives one too, spreading each turn
// over many small-angle segments instead of concentrating it at a single vertex.
const RESAMPLE_SPACING_M = 4;

/** Builds a smooth per-vertex path with a plausible elevation profile (descending for
 * steep/ghat roads) and flags hazardous vertices (sharp turns, especially unprotected ones). */
export function buildPath(road: Road): PathPoint[] {
  const xy = road.geometry.local_xy;
  const totalLen = road.geometry.length_m || 1;
  const slopeFrac = road.features.slope_pct / 100;
  // Cap the visual drop: a literal slope% * length reads as a sheer 100m+ cliff on long
  // roads, which overwhelms the close-up chase camera. 40m is dramatic without being unreadable.
  const totalDrop = Math.min(totalLen * slopeFrac, 40);
  if (xy.length < 2) return [];

  const rawCum: number[] = [0];
  for (let i = 1; i < xy.length; i++) {
    rawCum.push(rawCum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  }
  const rawElev = (i: number) => {
    const t = rawCum[i] / totalLen;
    return -t * totalDrop + Math.sin(i * 1.7) * (slopeFrac > 0.05 ? 1.2 : 0.15);
  };
  const rawHazard = (i: number): boolean => {
    if (i <= 0 || i >= xy.length - 1) return false;
    const a = Math.atan2(xy[i][1] - xy[i - 1][1], xy[i][0] - xy[i - 1][0]);
    const b = Math.atan2(xy[i + 1][1] - xy[i][1], xy[i + 1][0] - xy[i][0]);
    let diff = Math.abs(a - b);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    return (diff * 180) / Math.PI > 25;
  };
  const clampIdx = (i: number) => Math.max(0, Math.min(xy.length - 1, i));

  // Catmull-Rom resample: for each raw segment [i, i+1], step through t in
  // [0, 1) at ~RESAMPLE_SPACING_M intervals. t=0 lands exactly on raw vertex i
  // (a property of Catmull-Rom splines), so the hazard flag transfers over
  // without duplicating onto every new sub-point near that vertex.
  const dense: { x: number; y: number; elev: number; hazard: boolean }[] = [];
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[clampIdx(i - 1)], p1 = xy[i], p2 = xy[i + 1], p3 = xy[clampIdx(i + 2)];
    const segLen = rawCum[i + 1] - rawCum[i];
    const steps = Math.max(1, Math.round(segLen / RESAMPLE_SPACING_M));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t, t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      const elev = rawElev(i) + (rawElev(i + 1) - rawElev(i)) * t;
      dense.push({ x, y, elev, hazard: s === 0 && rawHazard(i) });
    }
  }
  const lastRaw = xy[xy.length - 1];
  dense.push({ x: lastRaw[0], y: lastRaw[1], elev: rawElev(xy.length - 1), hazard: rawHazard(xy.length - 1) });

  let cum = 0;
  const points: PathPoint[] = dense.map((p, i) => {
    if (i > 0) cum += Math.hypot(p.x - dense[i - 1].x, p.y - dense[i - 1].y);
    return { x: p.x, y: p.y, elev: p.elev, heading: 0, ribbonHeading: 0, s: cum, hazard: p.hazard };
  });

  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    let heading = 0;
    if (i < n - 1) {
      heading = Math.atan2(-(points[i + 1].y - p.y), points[i + 1].x - p.x);
    } else if (i > 0) {
      heading = Math.atan2(-(p.y - points[i - 1].y), p.x - points[i - 1].x);
    }
    p.heading = heading;

    let ribbonHeading = heading;
    if (i > 0 && i < n - 1) {
      const inHeading = Math.atan2(-(p.y - points[i - 1].y), p.x - points[i - 1].x);
      const outHeading = Math.atan2(-(points[i + 1].y - p.y), points[i + 1].x - p.x);
      // Sum the two segments' unit direction vectors and re-derive a heading from
      // that — the vector-sum bisector, robust to wraparound (unlike averaging the
      // two angles directly, which breaks near +-180 deg).
      const sx = Math.cos(inHeading) + Math.cos(outHeading);
      const sy = -Math.sin(inHeading) - Math.sin(outHeading);
      if (Math.hypot(sx, sy) > 1e-6) ribbonHeading = Math.atan2(-sy, sx);
    }
    p.ribbonHeading = ribbonHeading;
  }

  return points;
}

/** Nearest point on `points` at arc-length `s`, linearly interpolated between the
 * two bracketing vertices. Used to place things at fixed real-world spacing
 * (guardrail segments, streetlights, trees) regardless of how densely buildPath's
 * own vertices happen to be spaced. */
export function sampleAlongPath(points: PathPoint[], s: number): PathPoint {
  const last = points[points.length - 1];
  if (s <= points[0].s) return points[0];
  if (s >= last.s) return last;
  for (let i = 1; i < points.length; i++) {
    if (s <= points[i].s) {
      const a = points[i - 1], b = points[i];
      const t = (s - a.s) / Math.max(b.s - a.s, 1e-6);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        elev: a.elev + (b.elev - a.elev) * t,
        heading: a.heading + (b.heading - a.heading) * t,
        ribbonHeading: a.ribbonHeading + (b.ribbonHeading - a.ribbonHeading) * t,
        s, hazard: false,
      };
    }
  }
  return last;
}

export function perpendicular(heading: number): [number, number] {
  return [Math.sin(heading), Math.cos(heading)];
}

export function catmullRomThrough(points: PathPoint[]): THREE.CatmullRomCurve3 {
  const vecs = points.map((p) => new THREE.Vector3(...toWorld(p.x, p.y, p.elev)));
  return new THREE.CatmullRomCurve3(vecs, false, "catmullrom", 0.15);
}

/** Deterministic pseudo-random generator seeded by a string, for stable procedural scenery. */
export function seededRng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
