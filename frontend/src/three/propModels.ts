/** Kenney City Kit (Roads) + Racing Kit (both CC0, kenney.nl via opengameart.org),
 * self-hosted under public/models/props/. Real streetlight, warning sign, and
 * road-sign meshes instead of procedural primitives.
 *
 * road-side-barrier.glb (City Kit Roads) turned out to be a ~0.08-unit-tall curb
 * tile, not a crash barrier — invisible at road scale. A straight rigid fence
 * segment (Racing Kit's fenceStraight) was tried next, but a fixed-length rigid
 * panel can only be tangent-aligned at ONE end — on a real curve its far end
 * drifts off the curve, showing gaps/overlaps between segments. Guardrails are
 * now individual procedural bollard posts (Infrastructure.tsx's GuardPosts) —
 * each is a single point on the curve with no length to drift over, so it's
 * exact on every curve regardless of sharpness — instead of a GLTF import. */
export const STREETLIGHT_MODEL = "/models/props/light-curved.glb";
export const WARNING_SIGN_MODEL = "/models/props/road-sign-object-warning.glb";
export const STOP_SIGN_MODEL = "/models/props/road-sign-object-stop.glb";
export const CONE_MODEL = "/models/props/construction-cone.glb";

export const PROP_MODELS = [
  STREETLIGHT_MODEL, WARNING_SIGN_MODEL, STOP_SIGN_MODEL, CONE_MODEL,
];
