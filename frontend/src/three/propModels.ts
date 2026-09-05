/** Kenney City Kit (Roads) + Racing Kit (both CC0, kenney.nl via opengameart.org),
 * self-hosted under public/models/props/. Real streetlight, warning sign, and
 * guardrail meshes instead of procedural primitives.
 *
 * road-side-barrier.glb (City Kit Roads) turned out to be a ~0.08-unit-tall curb
 * tile, not a crash barrier — invisible at road scale. Swapped the guardrail to
 * Racing Kit's fenceStraight (0.5 units tall trackside fence), which actually
 * reads as a barrier. */
export const STREETLIGHT_MODEL = "/models/props/light-curved.glb";
export const GUARDRAIL_MODEL = "/models/props/fence/fenceStraight.gltf";
export const WARNING_SIGN_MODEL = "/models/props/road-sign-object-warning.glb";
export const STOP_SIGN_MODEL = "/models/props/road-sign-object-stop.glb";
export const CONE_MODEL = "/models/props/construction-cone.glb";

export const PROP_MODELS = [
  STREETLIGHT_MODEL, GUARDRAIL_MODEL, WARNING_SIGN_MODEL, STOP_SIGN_MODEL, CONE_MODEL,
];
