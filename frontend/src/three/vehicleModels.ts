/** Kenney Car Kit (CC0, kenney.nl via opengameart.org) — self-hosted under
 * public/models/cars/. Real low-poly car meshes instead of procedural boxes. */
export const CAR_MODELS = [
  "/models/cars/sedan.glb",
  "/models/cars/suv.glb",
  "/models/cars/taxi.glb",
  "/models/cars/hatchback-sports.glb",
  "/models/cars/van.glb",
  "/models/cars/delivery.glb",
  "/models/cars/police.glb",
  "/models/cars/ambulance.glb",
];

export function modelForVehicle(id: number): string {
  return CAR_MODELS[id % CAR_MODELS.length];
}
