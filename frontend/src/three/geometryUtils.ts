import * as THREE from "three";
import type { Road } from "../types";

// Risk color/category helpers now live in lib/riskColors.ts (dependency-free,
// so pages that don't need the 3D scene — e.g. the Home map — can import them
// without pulling in three.js). Re-exported here so every existing import of
// "../three/geometryUtils" / "../../three/geometryUtils" keeps working.
export { RISK_COLORS, riskColor, riskCategoryFromScore } from "../lib/riskColors";

/** local_xy (x=east, y=north) meters -> three.js world space (x=x, z=-y, y=elevation) */
export function toWorld(x: number, y: number, elev: number): [number, number, number] {
  return [x, elev, -y];
}

// Per-lane half-width, in meters (the whole scene is ~1 unit = 1 meter — see
// vehicle/prop model comments). 2.0 (≈4.0m/lane) matched a real US lane closely
// but read as small on screen next to everything else at real scale; 2.6
// (≈5.2m/lane) was a first bump, still read as thin — 3.5 (≈7.0m/lane) as a
// deliberate visual-scale choice (not a realism one) so the carriageway reads
// as a genuinely thick/wide road, not just closer to camera. Every scene file
// that draws the road/terrain corridor/roadside props needs the SAME value,
// so it lives here once rather than as four independently-drifting copies of
// the same formula — and the backend's traffic_sim.py LANE_WIDTH_M (vehicle
// lane placement) has to be kept at exactly 2x this or vehicles drift off the
// rendered lane center (see that file's own comment on the same constant).
const HALF_WIDTH_PER_LANE_M = 3.5;

export function roadHalfWidth(road: Road): number {
  return Math.max(2, road.features.lanes) * HALF_WIDTH_PER_LANE_M;
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
  const rawHazard = (i: number): boolean => {
    if (i <= 0 || i >= xy.length - 1) return false;
    const a = Math.atan2(xy[i][1] - xy[i - 1][1], xy[i][0] - xy[i - 1][0]);
    const b = Math.atan2(xy[i + 1][1] - xy[i][1], xy[i + 1][0] - xy[i][0]);
    let diff = Math.abs(a - b);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    return (diff * 180) / Math.PI > 25;
  };
  // Centripetal Catmull-Rom fit through the RAW points, sampled at uniform
  // arc length. This replaces a hand-rolled resampler that used the classic
  // UNIFORM Catmull-Rom basis matrix — the exact same loop/cusp-prone
  // parametrization already fixed one level up in Road.tsx's own curve
  // (catmullRomThrough uses 'centripetal' for this reason). A real route can
  // include a near-180deg reversal (e.g. a short local-street route with a
  // U-turn maneuver) close together in raw points, and the uniform variant
  // can bow the fitted curve out into an actual self-intersecting loop right
  // there — confirmed by a screenshot of the rendered road ribbon crossing
  // itself in an X, which is what corrupted the vehicle's derived heading
  // into spinning instead of turning. A loop baked in at THIS stage, in the
  // dense points every downstream system (Road.tsx's later re-fit,
  // Infrastructure, Vehicles) builds from, can't be un-looped after the fact
  // — this is the one place that actually has to not loop in the first place.
  const planarCurve = new THREE.CatmullRomCurve3(
    xy.map(([x, y]) => new THREE.Vector3(x, y, 0)),
    false,
    "centripetal"
  );
  const curveLen = planarCurve.getLength();
  const steps = Math.max(2, Math.round(curveLen / RESAMPLE_SPACING_M));

  const dense: { x: number; y: number; elev: number; hazard: boolean }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pt = planarCurve.getPointAt(t);
    const elev = -t * totalDrop;
    dense.push({ x: pt.x, y: pt.y, elev, hazard: false });
  }

  // Hazard flags are about the RAW route's own sharp-turn vertices, not the
  // resampled density — map each flagged raw vertex onto whichever new dense
  // sample sits closest to it by fraction along the route.
  const rawTotal = rawCum[rawCum.length - 1] || 1;
  for (let i = 1; i < xy.length - 1; i++) {
    if (!rawHazard(i)) continue;
    const idx = Math.max(0, Math.min(steps, Math.round((rawCum[i] / rawTotal) * steps)));
    dense[idx].hazard = true;
  }

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

export interface WorldBounds {
  minX: number; maxX: number; minZ: number; maxZ: number;
  centerX: number; centerZ: number;
  // Range of the road's OWN authored elevation profile (buildPath's p.elev) —
  // NOT the full terrain height range (that also adds fBm ridge noise and
  // EMBANKMENT_DROP on top, see terrainHeight.ts) but the base a caller needs
  // to combine with a TerrainHeightSampler's own ridgeAmplitude to bound the
  // real ground height anywhere under this road's terrain patch.
  minElev: number; maxElev: number;
}

/** World-space (x, z) bounding box of a road's own path — the SAME box Terrain.tsx
 * sizes/centers its ground plane from. A road's local_xy is centered on its own
 * centroid (see feature_extraction.py's ref_lat/ref_lon), NOT necessarily on world
 * origin, and a long route's bounds can run well past a small fixed box around
 * (0,0,0) — anything that needs to cover "the whole visible map" (weather, fog
 * distance, etc.) has to size itself off THIS, not assume the road sits near
 * origin or fits some fixed span. Kept here as the one shared computation rather
 * than each caller re-deriving its own (slightly different, easy to drift) bounds. */
export function pathWorldBounds(points: PathPoint[]): WorldBounds {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let minElev = Infinity, maxElev = -Infinity;
  for (const p of points) {
    const [wx, , wz] = toWorld(p.x, p.y, 0);
    minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
    minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
    minElev = Math.min(minElev, p.elev); maxElev = Math.max(maxElev, p.elev);
  }
  if (!isFinite(minX)) { minX = maxX = minZ = maxZ = 0; }
  if (!isFinite(minElev)) { minElev = maxElev = 0; }
  return { minX, maxX, minZ, maxZ, centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2, minElev, maxElev };
}

/** Convenience wrapper for callers (e.g. WeatherEffects) that don't already have
 * `points` computed for anything else — Terrain.tsx should call pathWorldBounds
 * directly with ITS OWN already-memoized points instead, to avoid running
 * buildPath's Catmull-Rom resample twice per render. */
export function roadWorldBounds(road: Road): WorldBounds {
  return pathWorldBounds(buildPath(road));
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
  // 'catmullrom' (three.js's name for the classic UNIFORM parametrization)
  // with a hand-tuned tension looked fine on hand-placed, evenly-spaced
  // control points, but real GPS-derived road data is never evenly spaced —
  // buildPath's per-raw-segment resampling produces denser points through
  // some stretches than others, and the uniform variant is well-documented
  // (see three.js's own CatmullRomCurve3 source/comments, citing Yuksel's
  // "On the Parameterization of Catmull-Rom Curves" paper) to loop and cusp
  // exactly where control-point spacing is uneven — which is what kept
  // showing up as roads twisting/folding on some real routes even after
  // fixing the sampling and tension separately. 'centripetal' is three.js's
  // OWN default for this reason: it's the standard fix for irregular real-
  // world point data, not a per-tension tuning problem. It ignores the
  // tension argument entirely (only 'catmullrom' uses it).
  const vecs = points.map((p) => new THREE.Vector3(...toWorld(p.x, p.y, p.elev)));
  return new THREE.CatmullRomCurve3(vecs, false, "centripetal");
}

/** Builds the EXACT same 3D curve Road.tsx renders the asphalt/lane-marking/
 * edge-line geometry from (buildPath's points refit through catmullRomThrough).
 * Anything placed by sampling THIS curve — not by re-walking buildPath's raw
 * point list with sampleAlongPath/perpendicular, a totally different (older,
 * 2D, non-arc-length) system — is guaranteed to land exactly on Road.tsx's
 * rendered surface/lines, because it's the same curve object type sampled the
 * same way. Guardrails/lamps previously used the old system and its offset
 * distance could match Road.tsx's edge-line offset in NUMBER but still miss
 * the actual rendered line's position, because the two were tracking two
 * different curves fit through the same underlying points. */
export function buildRoadCurve(road: Road): { curve: THREE.CatmullRomCurve3; length: number } {
  const curve = catmullRomThrough(buildPath(road));
  return { curve, length: curve.getLength() };
}

const CURVE_UP = new THREE.Vector3(0, 1, 0);

export interface CurvePoint {
  /** World-space position exactly on the rendered curve. */
  point: THREE.Vector3;
  /** atan2(tangent.z, tangent.x) — identical convention to PathPoint.heading
   * (verified: toWorld's (x,y,elev)->(x,elev,-y) makes world tangent.z equal
   * to the same -dy term PathPoint.heading's atan2 uses), so any rotation
   * math already written against p.heading/-p.heading needs no changes. */
  heading: number;
  /** World-space, always lies flat in the XZ plane (cross of any vector with
   * (0,1,0) has zero Y component) — a unit "sideways" direction from the
   * curve, the same role perpendicular(heading) played, but derived from the
   * curve's own true tangent instead of a separately-computed 2D bisector. */
  binormal: THREE.Vector3;
}

/** Samples buildRoadCurve's curve at real arc-length distance `s` along the
 * road (clamped to the curve's actual length) — the drop-in replacement for
 * `sampleAlongPath(points, s)` + `perpendicular(p.ribbonHeading)` wherever a
 * prop needs to land exactly on Road.tsx's rendered surface. */
export function sampleRoadCurveAt(curve: THREE.CatmullRomCurve3, curveLength: number, s: number): CurvePoint {
  const t = curveLength > 1e-6 ? Math.max(0, Math.min(1, s / curveLength)) : 0;
  const point = curve.getPointAt(t);
  const tangent = curve.getTangentAt(t).normalize();
  const binormal = new THREE.Vector3().crossVectors(tangent, CURVE_UP).normalize();
  const heading = Math.atan2(tangent.z, tangent.x);
  return { point, heading, binormal };
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
