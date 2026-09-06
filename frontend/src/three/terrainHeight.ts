import { createNoise2D } from "simplex-noise";
import type { PathPoint } from "./geometryUtils";

/**
 * Fractal Brownian Motion over simplex noise — real terrain relief instead of the
 * old 2-term sine sum, which had one fixed wavelength and produced a visible
 * repeating ridge pattern (looked like a sawtooth/contour-map skyline, not a
 * hillside) once viewed from a low, grazing camera angle.
 *
 * Frequency/octave values came from sizing against this scene's actual terrain
 * plane (a ~3400+ unit square) — a "textbook" noise frequency (~0.01+) is far too
 * high at this world scale and reads as static; 0.0006 base frequency spreads
 * rolling hills across the whole plane instead of tiling many tiny bumps.
 */
/** mulberry32 — tiny deterministic PRNG so createNoise2D's permutation table is
 * seeded reproducibly instead of Math.random() (different terrain every reload)
 * or a constant (degenerate, unshuffled table). */
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeFbm(seed: number) {
  const noise2D = createNoise2D(mulberry32(seed));
  return function fbm(x: number, z: number, octaves = 4, baseFreq = 0.0006, persistence = 0.5, lacunarity = 2) {
    let amplitude = 1;
    let frequency = baseFreq;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise2D(x * frequency, z * frequency) * amplitude;
      max += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return sum / max; // normalized to [-1, 1]
  };
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Both Terrain.tsx (the mesh) and Scenery.tsx (tree/building ground placement)
 * must build a sampler seeded identically, or they'd each roll their own noise
 * field and trees would float/sink relative to the ground right under them. */
export function terrainSeedFor(roadId: string, pointCount: number): number {
  return roadId.length + pointCount;
}

/**
 * How far the ground sits BELOW the road surface inside the corridor.
 *
 * The corridor used to be pinned to exactly the road's elevation, which made the
 * carriageway and the ground coplanar. Two things then push the ground through
 * the road: (1) the terrain mesh only samples this function on a ~13-unit grid
 * (256 segments over a 3400+ unit plane) while the road is 6.8 units wide, so the
 * surface actually rendered between grid vertices is a linear interpolation that
 * overshoots wherever the road's elevation profile curves; (2) near a switchback,
 * adjacent grid vertices snap to *different arms* of the hairpin, which sit at
 * different heights, so the interpolated ground steps straight across the road.
 *
 * Real roads are built up on an embankment rather than laid flush into the dirt,
 * so dropping the corridor and giving the road a shoulder (see Road.tsx) fixes the
 * clipping and is closer to how a road actually sits in the landscape. The value
 * has to exceed the grid's interpolation error, which is ~0.5-0.9 units here.
 */
export const EMBANKMENT_DROP = 0.9;

/** Horizontal run of the embankment slope, from the carriageway edge out to where
 * the ground levels off. Road.tsx draws the slope; Infrastructure.tsx uses the
 * same pair of constants to sit roadside props ON that slope instead of leaving
 * them floating at carriageway height. */
export const SHOULDER_WIDTH = 1.8;

/** Height of a roadside object `lateralOffset` metres out from the road EDGE:
 * carriageway level at the edge, full ground level once past the shoulder. */
export function shoulderDrop(lateralOffset: number): number {
  const t = Math.min(1, Math.max(0, lateralOffset / SHOULDER_WIDTH));
  return EMBANKMENT_DROP * t;
}

export interface TerrainHeightSampler {
  /** Absolute elevation at a WORLD (x, z) — same units/frame as toWorld()'s elev axis. */
  height(worldX: number, worldZ: number): number;
  ridgeAmplitude: number;
}

/**
 * A single ground-truth height function shared by the terrain mesh, the cliff
 * face, and (potentially) prop placement. Terrain rolls as fBm noise far from the
 * road, but is blended toward the road's own authored elevation profile within a
 * feathered corridor around it — this is what makes hills actually rise and fall
 * with a climbing/descending road instead of sitting at one flat base offset
 * underneath it, and guarantees anything placed at the road's elevation can never
 * float above or clip into the terrain directly beneath it.
 */
export function createTerrainHeightSampler(
  points: PathPoint[],
  halfWidth: number,
  isHilly: boolean,
  seed = 1
): TerrainHeightSampler {
  const fbm = makeFbm(seed);
  // Enough relief to actually read as hills once the scene is lit by a real sky —
  // at 22/5 under daylight the ground was a flat green field with a dead-straight
  // horizon, which is not what a Western Ghats ghat road sits in.
  const ridgeAmplitude = isHilly ? 34 : 9;
  // The corridor kept flat around the road is widened to match. With the old
  // halfWidth+6 feather, terrain at full ridge amplitude started within ~30m of the
  // carriageway, so a hill could rise between the camera and the road and swallow
  // it. Holding the road in an open valley and pushing the hills further out keeps
  // the sightline clear while still giving the horizon some shape.
  const feather = halfWidth + 22;

  function nearestOnPath(x: number, y: number) {
    let bestD2 = Infinity;
    let bestElev = points[0]?.elev ?? 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const abx = b.x - a.x, aby = b.y - a.y;
      const len2 = abx * abx + aby * aby || 1e-6;
      let t = ((x - a.x) * abx + (y - a.y) * aby) / len2;
      t = Math.min(1, Math.max(0, t));
      const px = a.x + abx * t, py = a.y + aby * t;
      const dx = x - px, dy = y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestElev = a.elev + (b.elev - a.elev) * t;
      }
    }
    return { dist: Math.sqrt(bestD2), elev: bestElev };
  }

  function height(worldX: number, worldZ: number): number {
    // toWorld(x, y, elev) = (x, elev, -y) — invert back to the road's local frame.
    const x = worldX, y = -worldZ;
    const ridge = fbm(worldX, worldZ) * ridgeAmplitude;
    if (points.length < 2) return ridge;
    const { dist, elev } = nearestOnPath(x, y);
    const t = smoothstep(feather, feather * 4, dist);
    // Always anchored to the nearest road point's own elevation, not just the
    // noise field's absolute value — otherwise hills far from the road snap back
    // toward 0 regardless of how high/low the road has climbed, creating a visible
    // discontinuity right at the feather boundary instead of a smooth hillside.
    // The corridor sits EMBANKMENT_DROP below the carriageway so the two surfaces
    // are never coplanar (see the constant's note).
    return elev - EMBANKMENT_DROP + ridge * t;
  }

  return { height, ridgeAmplitude };
}
