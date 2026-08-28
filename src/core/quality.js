/**
 * Quality tiers (Task 4.2).
 *
 * One object decides every expensive switch in the app. Systems read from it,
 * never from `isMobile` checks scattered around the codebase.
 */

const TIERS = {
  low: {
    name: 'low',
    pixelRatio: 1,
    bloom: false,
    grain: false,
    chromatic: false,
    shadows: false,
    shadowSize: 0,
    pedestrians: 6,
    dustMotes: 0,
    rainDrops: 0,
    steamPuffs: 0,
    streetLength: 22,
    maxLoadedInteriors: 1,
    interiorDetail: 'flat',
    reflections: false,
    fpsFloor: 30,
  },
  medium: {
    name: 'medium',
    pixelRatio: 1.35,
    bloom: true,
    bloomStrengthScale: 0.7,
    grain: true,
    chromatic: false,
    shadows: true,
    shadowSize: 1024,
    pedestrians: 12,
    dustMotes: 260,
    rainDrops: 1400,
    steamPuffs: 70,
    streetLength: 34,
    maxLoadedInteriors: 2,
    interiorDetail: 'medium',
    reflections: false,
    fpsFloor: 45,
  },
  high: {
    name: 'high',
    pixelRatio: 2,
    bloom: true,
    bloomStrengthScale: 1,
    grain: true,
    chromatic: true,
    shadows: true,
    shadowSize: 2048,
    pedestrians: 18,
    dustMotes: 600,
    rainDrops: 3200,
    steamPuffs: 160,
    streetLength: 46,
    maxLoadedInteriors: 3,
    interiorDetail: 'high',
    reflections: true,
    fpsFloor: 55,
  },
};

const WEAK_GPU = /(mali-[t4-6]|adreno \(tm\) [3-5]|powervr|videocore|intel.*(hd|gma) (graphics )?[0-3]?\d{3}|apple a[789])/i;
const STRONG_GPU = /(rtx|radeon rx|apple m[1-9]|adreno \(tm\) 7|nvidia geforce (gtx 1[06]|rtx))/i;

function readGpuString(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  } catch {
    return '';
  }
}

export function detectTier({ force } = {}) {
  const override = force || new URLSearchParams(location.search).get('tier');
  if (override && TIERS[override]) return { ...TIERS[override], detectedFrom: 'override' };

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  const gpu = gl ? readGpuString(gl) : '';
  const mobile = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || navigator.deviceMemoryGB || 0;

  let tier = 'high';
  if (mobile) tier = 'medium';
  if (WEAK_GPU.test(gpu) || cores <= 4 || (memory && memory <= 3)) tier = 'low';
  if (!mobile && STRONG_GPU.test(gpu) && cores >= 8) tier = 'high';
  if (!gl) tier = 'low';

  return {
    ...TIERS[tier],
    detectedFrom: gpu || (mobile ? 'mobile-ua' : 'unknown'),
    isMobile: mobile,
    pixelRatio: Math.min(TIERS[tier].pixelRatio, window.devicePixelRatio || 1),
  };
}

/**
 * Watchdog: if the measured framerate sits under the tier's floor for a while,
 * step down. "Everything janky" has a fallback too (Risk Register).
 */
export function makeTierWatchdog(quality, onDowngrade) {
  const order = ['high', 'medium', 'low'];
  let budget = 0;
  let cooldown = 6;

  return function sample(fps, dt) {
    if (cooldown > 0) { cooldown -= dt; return; }
    budget += fps < quality.fpsFloor * 0.8 ? dt : -dt * 0.5;
    budget = Math.max(0, budget);
    if (budget < 4) return;

    const next = order[order.indexOf(quality.name) + 1];
    budget = 0;
    cooldown = 10;
    if (!next) return;
    Object.assign(quality, TIERS[next], { detectedFrom: 'watchdog', isMobile: quality.isMobile });
    onDowngrade?.(next);
  };
}

export { TIERS };
