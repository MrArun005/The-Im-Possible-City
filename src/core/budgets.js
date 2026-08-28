/**
 * §3.4 Performance budgets, as data. The HUD reads these, the build-time budget
 * script reads these, and the docs are generated from these - so the numbers in
 * the plan can never quietly drift away from the numbers in the code.
 */
export const BUDGETS = {
  streetTriangles: 300_000,
  interiorTriangles: 100_000,
  loadedInteriors: 3,
  videoDecodes: 1,
  realtimeLights: 3,
  drawCalls: 150,
  fpsDesktop: 60,
  fpsMobileFloor: 30,
  initialPayloadBytes: 8 * 1024 * 1024,
  interiorTextures: 4,
  interiorTextureSize: 2048,
};

/**
 * Render layers.
 *
 * INTERIOR_LIGHT exists because a PointLight inside a room does not respect the
 * room's walls - there are no shadow-casting point lights in this project, so a
 * lamp in a study would happily light the pavement, the railings and the facade
 * three metres away through solid brick. Putting the light on its own layer and
 * enabling that layer only on the interior's own meshes makes the walls opaque
 * to light for free.
 */
export const LAYER = {
  DEFAULT: 0,
  INTERIOR_LIGHT: 1,
};

export function overBudget(key, value) {
  const limit = BUDGETS[key];
  return limit != null && value > limit;
}
