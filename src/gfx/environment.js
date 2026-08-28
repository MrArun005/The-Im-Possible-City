import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { bus } from '../util/events.js';

/**
 * Real captured HDRI lighting.
 *
 * Everything else in this project is generated at runtime, and that ceiling is
 * visible: a sky prefiltered from a three-stop gradient gives you ambient of
 * roughly the right colour and nothing else. A real environment capture gives
 * directional ambient, believable falloff into corners, and actual reflections
 * in the glass and the wet road - which is most of the distance between "a lit
 * box" and "a place".
 *
 * SOURCE AND LICENCE: `@pmndrs/assets`, CC0-1.0 (a verified licence file ships
 * in the package, which is why this source was chosen over the three.js example
 * assets - those carry no per-asset licence at all). The files arrive as base64
 * `data:` URIs, so they need no server, survive the single-file build, and are
 * imported dynamically to stay out of the initial payload.
 *
 * Failure is not fatal: on any error this returns null and the caller keeps the
 * procedural sky PMREM. One more rung on the same ladder as everything else.
 */

const SOURCES = {
  night: () => import('@pmndrs/assets/hdri/night.exr'),
  city: () => import('@pmndrs/assets/hdri/city.exr'),
  dawn: () => import('@pmndrs/assets/hdri/dawn.exr'),
  apartment: () => import('@pmndrs/assets/hdri/apartment.exr'),
  lobby: () => import('@pmndrs/assets/hdri/lobby.exr'),
};

const cache = new Map();

export function availableEnvironments() {
  return Object.keys(SOURCES);
}

/**
 * Loads, prefilters and caches an environment. Returns a PMREM texture ready
 * for `scene.environment`, or null if anything at all went wrong.
 */
export async function loadEnvironment(name, renderer) {
  if (!name) return null;
  if (cache.has(name)) return cache.get(name);

  const source = SOURCES[name];
  if (!source) {
    console.warn(`[environment] unknown environment "${name}"`);
    return null;
  }

  try {
    const module = await source();
    const dataUri = module.default ?? module;

    const raw = await new EXRLoader().loadAsync(dataUri);
    raw.mapping = THREE.EquirectangularReflectionMapping;

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const target = pmrem.fromEquirectangular(raw);

    raw.dispose();
    pmrem.dispose();

    const entry = { texture: target.texture, target, name };
    cache.set(name, entry);
    bus.emit('assets:environment', { name });
    return entry;
  } catch (err) {
    console.warn(
      `[environment] "${name}" unavailable (${err.message}); ` +
      'falling back to the procedural sky'
    );
    return null;
  }
}

export function clearEnvironmentCache() {
  for (const entry of cache.values()) entry.target.dispose();
  cache.clear();
}
