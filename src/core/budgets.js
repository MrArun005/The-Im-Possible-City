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

export function overBudget(key, value) {
  const limit = BUDGETS[key];
  return limit != null && value > limit;
}
