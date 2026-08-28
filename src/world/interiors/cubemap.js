import * as THREE from 'three';
import { ProceduralInterior } from './procedural.js';
import { disposeSubtree } from '../../util/dispose.js';

/**
 * The `cubemap` interior strategy (Task 0.6).
 *
 * Two ways in:
 *   1. `src` points at a directory of six faces -> CubeTextureLoader.
 *   2. no `src` -> we build the room once, put a CubeCamera at its centre,
 *      render the six faces, and throw the geometry away. That is the plan's
 *      "6-face room render", done at runtime.
 *
 * Either way the room becomes one box drawn with BackSide and a box-projected
 * cubemap lookup: the visible fragment on a back face *is* the point the eye
 * ray hits, so sampling `normalize(localPos - centre)` is parallax-exact for
 * content that lives on the walls. Cost: one draw call, no lights, no shadows.
 */
export class CubemapInterior {
  constructor(spec, ctx) {
    this.spec = spec;
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = `interior:cubemap:${spec.id ?? ''}`;
    this.triangles = 12;
    this.focused = false;
    this._time = 0;
  }

  async load() {
    const spec = this.spec;
    const [w, h, d] = spec.size ?? spec.recipe?.size ?? [4.2, 2.9, 4.6];
    this.size = [w, h, d];

    // NOTE: deliberately `cubeSrc`, not `src`. When this strategy is reached as
    // a FALLBACK from gltf/splat/video, `spec.src` still holds that rung's file
    // path - treating it as a cubemap directory just fails a second time for
    // the wrong reason. A cubemap only loads from disk if it was given its own
    // directory; otherwise it bakes from the recipe, which cannot fail.
    const cube = spec.cubeSrc
      ? await loadCubeFaces(spec.cubeSrc, spec.faces)
      : this._bake(spec.recipe, [w, h, d]);

    // The box sits with its front face at the doorway, like every interior.
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(0, h / 2, -d / 2);

    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uCube: { value: cube },
        uCentre: { value: new THREE.Vector3(0, h / 2, -d / 2) },
        uExposure: { value: spec.exposure ?? 1 },
        uTint: { value: new THREE.Color(spec.tint ?? 0xffffff) },
        uFlicker: { value: spec.flicker ?? 0 },
        uContrast: { value: spec.contrast ?? 1.35 },
        uSaturation: { value: spec.saturation ?? 1.15 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vLocal;
        void main() {
          vLocal = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform samplerCube uCube;
        uniform vec3  uCentre;
        uniform float uExposure;
        uniform vec3  uTint;
        uniform float uFlicker;
        uniform float uContrast;
        uniform float uSaturation;
        uniform float uTime;
        varying vec3 vLocal;

        void main() {
          vec3 dir = normalize(vLocal - uCentre);
          vec3 col = textureCube(uCube, dir).rgb * uExposure * uTint;

          /**
           * A bake is a photograph of a room, and like any photograph it comes
           * back flatter than the room was: one ambient pass, no local contrast,
           * everything pushed toward the mean. Grading it back here costs
           * nothing and is the difference between "a lit room behind the door"
           * and "an orange smear behind the door".
           */
          float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(luma), col, uSaturation);
          col = max((col - 0.18) * uContrast + 0.14, vec3(0.0));

          // A cubemap room is frozen. One flicker uniform buys it a heartbeat.
          col *= 1.0 + uFlicker * 0.12 * sin(uTime * 7.4) * sin(uTime * 2.3);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'cubemap-room';
    this.root.add(this.mesh);
    this._cube = cube;
    this.materials = [this.material];
    return this;
  }

  /** Renders a temporary build of the room into a cube render target. */
  _bake(recipe, size) {
    const { renderer, quality } = this.ctx;
    const resolution = quality.name === 'low' ? 256 : quality.name === 'medium' ? 512 : 768;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(recipe?.bakeBackground ?? 0x05040a);

    // The temporary room is built at full detail even on low tier: it is baked
    // once and then it is pixels, so detail here is free at runtime.
    const temp = new ProceduralInterior(
      { ...recipe, size, dust: false },
      { ...this.ctx, quality: { ...quality, interiorDetail: 'high', dustMotes: 0 } }
    );
    temp.setFocused(true);
    scene.add(temp.root);

    /**
     * Fill for the bake. Generous on purpose: a baked cubemap is the ONLY
     * lighting that room will ever have, so anything the bake loses is lost
     * permanently - and there is no runtime cost at all to a brighter capture.
     */
    const fill = new THREE.HemisphereLight(0x6a5842, 0x2a2018, 1.6);
    scene.add(fill);

    /**
     * NO MIPMAPS, deliberately.
     *
     * The lookup direction `normalize(localPos - centre)` swings fast across
     * adjacent pixels when the eye is close to a large box - which is exactly
     * the case at a doorway. Large UV derivatives make the GPU pick a high mip
     * level, and the room dissolves into a smear at the very moment you lean in
     * to look at it. Plain linear filtering stays sharp.
     */
    const target = new THREE.WebGLCubeRenderTarget(resolution, {
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
    });
    const cubeCamera = new THREE.CubeCamera(0.05, 60, target);
    cubeCamera.position.set(0, size[1] * 0.5, -size[2] * 0.5);

    const prevTarget = renderer.getRenderTarget();
    cubeCamera.update(renderer, scene);
    renderer.setRenderTarget(prevTarget);

    temp.dispose();
    fill.dispose?.();
    disposeSubtree(scene);

    this._ownedTarget = target;
    return target.texture;
  }

  setFocused(focused) { this.focused = focused; }

  update(dt) {
    this._time += dt;
    if (this.material) this.material.uniforms.uTime.value = this._time;
  }

  activate() {}
  deactivate() {}

  dispose() {
    disposeSubtree(this.root);
    this._ownedTarget?.dispose();
    if (!this._ownedTarget) this._cube?.dispose?.();
  }
}

const FACE_ORDER = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

function loadCubeFaces(dir, faces) {
  const base = dir.endsWith('/') ? dir : `${dir}/`;
  const names = faces ?? FACE_ORDER.map((f) => `${f}.jpg`);
  return new Promise((resolve, reject) => {
    new THREE.CubeTextureLoader()
      .setPath(base)
      .load(
        names,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          resolve(tex);
        },
        undefined,
        () => reject(new Error(`cubemap faces missing at ${base}`))
      );
  });
}
