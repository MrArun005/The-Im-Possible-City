import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BUDGETS } from '../../core/budgets.js';
import { disposeSubtree } from '../../util/dispose.js';

/**
 * The `gltf` interior strategy (Task 0.5 / Step 4).
 *
 * DRACO + KTX2 + meshopt are all wired, which is the whole of Task 4.1 for
 * interiors: drop a compressed .glb in and it just loads. Decoders come from
 * gstatic by default, as the instructions specify; `scripts/copy-decoders.mjs`
 * also stages local copies under /vendor/ for offline or air-gapped hosting,
 * selectable with `?decoders=local`.
 */
const GSTATIC_DRACO = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';
const LOCAL_DRACO = '/vendor/draco/';
const LOCAL_BASIS = '/vendor/basis/';

let loader = null;

export function getGltfLoader(renderer) {
  if (loader) return loader;
  const local = new URLSearchParams(location.search).get('decoders') === 'local';

  loader = new GLTFLoader();

  const draco = new DRACOLoader();
  draco.setDecoderPath(local ? LOCAL_DRACO : GSTATIC_DRACO);
  draco.setDecoderConfig({ type: 'js' });
  loader.setDRACOLoader(draco);

  if (renderer) {
    const ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath(LOCAL_BASIS);
    ktx2.detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
  }

  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

export class GltfInterior {
  constructor(spec, ctx) {
    this.spec = spec;
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = `interior:gltf:${spec.id ?? ''}`;
    this.triangles = 0;
    this.focused = false;
    this._mixer = null;
    this._time = 0;
  }

  async load() {
    const spec = this.spec;
    const gltf = await getGltfLoader(this.ctx.renderer).loadAsync(spec.src);
    const model = gltf.scene;

    // ---- calibration (§ "Scale/orientation" from the splat notes applies
    // just as much to downloaded GLBs, which arrive in arbitrary units) ----
    if (spec.autoFit !== false) this._autoFit(model, spec);
    if (spec.scale != null) model.scale.multiplyScalar(spec.scale);
    if (spec.rotation) model.rotation.fromArray(spec.rotation);
    if (spec.offset) model.position.add(new THREE.Vector3().fromArray(spec.offset));

    // ---- budget audit (§3.4): refuse to blow the budget silently ----
    let triangles = 0;
    const textures = new Set();
    model.traverse((o) => {
      if (o.isMesh) {
        const g = o.geometry;
        triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        o.castShadow = false;
        o.receiveShadow = false;
        for (const mat of [].concat(o.material)) {
          for (const key of Object.keys(mat)) {
            if (mat[key]?.isTexture) textures.add(mat[key]);
          }
        }
      }
    });
    this.triangles = triangles;

    if (triangles > BUDGETS.interiorTriangles) {
      throw new BudgetError(
        `${spec.src}: ${Math.round(triangles / 1000)}k triangles over the ` +
        `${BUDGETS.interiorTriangles / 1000}k interior budget`
      );
    }
    if (textures.size > BUDGETS.interiorTextures) {
      console.warn(
        `[gltf] ${spec.src} uses ${textures.size} textures ` +
        `(budget ${BUDGETS.interiorTextures}) - consider atlasing`
      );
    }

    this.root.add(model);
    this.model = model;

    if (gltf.animations?.length) {
      this._mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) this._mixer.clipAction(clip).play();
    }

    // A GLB of furniture usually has no walls, so the room shell that stops
    // the street from showing through is added here unless the model has one.
    if (spec.shell !== false) this._addShell(spec);

    return this;
  }

  /** Scales and centres the model so the floor sits at y=0 in the room box. */
  _autoFit(model, spec) {
    const [w, h, d] = spec.size ?? [4.2, 2.9, 4.6];
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    if (!size.length()) return;

    const fit = Math.min((w * 0.92) / size.x, (h * 0.92) / size.y, (d * 0.92) / size.z);
    if (Number.isFinite(fit) && fit > 0) model.scale.setScalar(fit);

    const scaled = new THREE.Box3().setFromObject(model);
    const centre = scaled.getCenter(new THREE.Vector3());
    model.position.x -= centre.x;
    model.position.z -= centre.z + d / 2;
    model.position.y -= scaled.min.y;   // floor to y = 0, eye height stays 1.6
  }

  _addShell(spec) {
    const [w, h, d] = spec.size ?? [4.2, 2.9, 4.6];
    const mat = new THREE.MeshStandardMaterial({
      color: spec.shellColor ?? 0x1a1512,
      roughness: 0.95,
      side: THREE.BackSide,
    });
    const geo = new THREE.BoxGeometry(w * 1.02, h, d * 1.02);
    geo.translate(0, h / 2, -d / 2);
    const shell = new THREE.Mesh(geo, mat);
    shell.name = 'gltf-shell';
    this.root.add(shell);
    this.shellMaterial = mat;
  }

  setFocused(focused) {
    this.focused = focused;
    this.root.traverse((o) => {
      if (o.isLight) o.intensity = focused ? (o.userData.baseIntensity ?? o.intensity) : 0;
    });
  }

  update(dt) {
    this._time += dt;
    this._mixer?.update(dt);
  }

  activate() {}
  deactivate() { this.setFocused(false); }
  dispose() { this._mixer?.stopAllAction(); disposeSubtree(this.root); }
}

export class BudgetError extends Error {}
