import * as THREE from 'three';
import { disposeSubtree } from '../../util/dispose.js';
import { bus } from '../../util/events.js';

/**
 * The `splat` interior strategy (Step 5) - Gaussian splats via @sparkjsdev/spark.
 *
 * Two things this module is careful about:
 *
 * 1. LAZY IMPORT. Spark is ~5MB of JS plus a WASM worker. Against an 8MB
 *    initial-payload budget it cannot sit in the main bundle, so it is
 *    `import()`ed the first time a splat door is actually approached, and
 *    Vite code-splits it into its own chunk. A city with no splat doors
 *    never downloads a byte of it.
 *
 * 2. MASKING. Spark draws splats through its own accumulator, so per-material
 *    stencil settings do not reach them. The instructions are explicit about
 *    what to do: take the box-room fallback. This interior therefore reports
 *    `maskable = false` and ships its own light-tight shell; the building wall
 *    and that shell do the masking, which is 90% of the effect at zero risk.
 */

let sparkModule = null;
let sparkRenderer = null;

async function ensureSpark(ctx) {
  if (!sparkModule) {
    sparkModule = await import('@sparkjsdev/spark');
    bus.emit('assets:chunk', { name: 'spark' });
  }
  if (!sparkRenderer) {
    // One SparkRenderer for the whole app; it must live in the scene.
    sparkRenderer = new sparkModule.SparkRenderer({ renderer: ctx.renderer });
    sparkRenderer.name = 'spark-renderer';
    ctx.scene.add(sparkRenderer);
  }
  return sparkModule;
}

export class SplatInterior {
  constructor(spec, ctx) {
    this.spec = spec;
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = `interior:splat:${spec.id ?? ''}`;
    this.triangles = 0;      // splats are not triangles; budget tracked as MB
    this.focused = false;
    this.maskable = false;   // see note 2 above
    this._time = 0;
  }

  async load() {
    const spec = this.spec;
    const spark = await ensureSpark(this.ctx);

    const splat = new spark.SplatMesh({ url: spec.src });

    /**
     * Calibration. Splats come out of Luma/Postshot in arbitrary units and,
     * for most trainers, upside down - hence the (1,0,0,0) quaternion in
     * Spark's own example, which is a 180 degrees flip about X. The numbers
     * below live in the door config so a room is calibrated once and never
     * again; `?splatdebug=1` prints the current transform to the console so
     * new numbers are easy to find.
     */
    const cal = {
      scale: 1,
      quaternion: [1, 0, 0, 0],
      rotation: null,
      offset: [0, 0, -2.2],
      ...(spec.calibration ?? {}),
    };

    if (cal.rotation) splat.rotation.fromArray(cal.rotation);
    else splat.quaternion.set(...cal.quaternion);
    splat.scale.setScalar(cal.scale);
    splat.position.fromArray(cal.offset);

    // `initialized` resolves once the file is fetched, unpacked and uploaded.
    await splat.initialized;

    this.splat = splat;
    this.root.add(splat);

    if (spec.shell !== false) this._addShell(spec);

    if (new URLSearchParams(location.search).has('splatdebug')) {
      this._debug();
    }
    return this;
  }

  /**
   * The light-tight room shell. Without it, a splat that is wider than the
   * doorway would be visible around the frame, since we cannot stencil it.
   */
  _addShell(spec) {
    const [w, h, d] = spec.size ?? [4.6, 3.0, 5.0];
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(0, h / 2, -d / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: spec.shellColor ?? 0x000000,
      side: THREE.BackSide,
      // The shell must not hide the splats inside it, so it writes depth only
      // where the splats do not: draw it first, then the splats over the top.
      depthWrite: true,
    });
    const shell = new THREE.Mesh(geo, mat);
    shell.name = 'splat-shell';
    shell.renderOrder = -1;
    this.root.add(shell);
    this.shellMaterial = mat;
  }

  _debug() {
    const t = this.splat;
    console.info(
      `[splat:${this.spec.id}] calibration\n` +
      `  scale:      ${t.scale.x}\n` +
      `  quaternion: [${t.quaternion.toArray().join(', ')}]\n` +
      `  offset:     [${t.position.toArray().join(', ')}]\n` +
      'Adjust in the door config under interior.calibration.'
    );
    window.__splat = t;   // tweak live from the console, then copy the numbers
  }

  setFocused(focused) { this.focused = focused; }

  update(dt) {
    this._time += dt;
    if (this.spec.spin) this.splat.rotation.y += dt * this.spec.spin;
  }

  activate() { if (this.splat) this.splat.visible = true; }
  deactivate() {}

  dispose() {
    this.splat?.dispose?.();
    disposeSubtree(this.root);
  }
}

/** Frees the shared SparkRenderer - called on full teardown only. */
export function disposeSparkRenderer() {
  sparkRenderer?.parent?.remove(sparkRenderer);
  sparkRenderer?.dispose?.();
  sparkRenderer = null;
}
