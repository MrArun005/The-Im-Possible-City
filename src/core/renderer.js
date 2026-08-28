import * as THREE from 'three';
import { LAYER } from './budgets.js';

/**
 * WebGLRenderer setup, per the implementation instructions Step 1.
 *
 * `stencil: true` is REQUIRED - the portal reveal is a stencil trick.
 *
 * Note on tone mapping: ACESFilmic / exposure 1.1 are set here so the
 * post-processing-off path (low tier, `?post=0`) looks right. Three disables
 * material tone mapping when rendering into a render target, so with the
 * composer active the *same* ACES curve and the same 1.1 exposure are applied
 * by the final grade pass instead (fx/post.js). One curve, two code paths.
 */
export function createRenderer(canvas, quality) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,  // matters when post is disabled; MSAA otherwise comes
                      // from the composer target's `samples`
    stencil: true,
    depth: true,
    powerPreference: 'high-performance',
    alpha: false,
  });

  renderer.setPixelRatio(Math.min(quality.pixelRatio, window.devicePixelRatio || 1));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.autoClearStencil = true;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;

  return renderer;
}

/** Hard rule: 1.6 m eye height. Every asset, door and splat is built to it. */
export const EYE_HEIGHT = 1.6;
export const EXPOSURE = 1.1;

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );
  camera.position.set(0, EYE_HEIGHT, 4);
  // Interior meshes live on layer 1 as well as 0 so their own lights can find
  // them; the camera has to be told to render that layer.
  camera.layers.enable(LAYER.INTERIOR_LIGHT);
  return camera;
}

export function bindResize(renderer, camera, composer) {
  const apply = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
  };

  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 250));
  apply();
  return apply;
}
