import * as THREE from 'three';
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';
import * as T from '../gfx/textures.js';
import { getGltfLoader } from './interiors/gltf.js';
import { disposeSubtree } from '../util/dispose.js';
import { makeRng } from '../util/rng.js';

/**
 * Pedestrians (Step 7, Tasks 2.1-2.3).
 *
 * Two implementations behind one interface, chosen at load time:
 *
 *   A. RIGGED - if the district provides `characterUrl`, the GLB is loaded once
 *      and cloned with SkeletonUtils; each clone gets its own AnimationMixer
 *      running the walk clip, exactly as the instructions describe.
 *
 *   B. SILHOUETTE - no character file, so we fall back one rung on the ladder
 *      (the risk register's "static silhouettes"), except animated: an 8-frame
 *      walk cycle drawn procedurally into a 4x2 atlas, played per instance via
 *      a UV offset in the vertex shader. The whole crowd is ONE draw call, and
 *      a silhouetted figure in a top hat with an umbrella, fading into fog, is
 *      more period-correct than a stock rigged businessman would be.
 *
 * Both share the path logic: t += speed * dt / length, position on the curve,
 * facing the point slightly ahead.
 */
export class Crowd {
  constructor({ paths, count, style = 'victorian', characterUrl = null, color = '#0b0a0c', height = 1.72 }, ctx) {
    this.ctx = ctx;
    this.paths = paths ?? [];
    this.count = Math.min(count ?? 12, 40);
    this.style = style;
    this.characterUrl = characterUrl;
    this.color = color;
    this.height = height;
    this.root = new THREE.Group();
    this.root.name = 'crowd';
    this.walkers = [];
    this.rng = makeRng(style === 'victorian' ? 1888 : 1977);
    this._time = 0;
    this._mode = 'none';
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  async load() {
    if (!this.paths.length || this.count <= 0) return this;
    this._seedWalkers();

    if (this.characterUrl) {
      try {
        await this._loadRigged();
        this._mode = 'rigged';
        return this;
      } catch (err) {
        console.warn(`[crowd] rigged characters unavailable (${err.message}); using silhouettes`);
      }
    }
    this._buildSilhouettes();
    this._mode = 'silhouette';
    return this;
  }

  get mode() { return this._mode; }

  _seedWalkers() {
    for (let i = 0; i < this.count; i++) {
      const pathIndex = i % this.paths.length;
      const path = this.paths[pathIndex];
      this.walkers.push({
        path,
        length: path.getLength(),
        t: this.rng(),
        // Speed variance and direction flip, as specified in Task 2.2.
        speed: this.rng.range(0.72, 1.45),
        dir: this.rng.chance(0.5) ? 1 : -1,
        scale: this.rng.range(0.92, 1.08),
        phase: this.rng(),
        // Occasional loiterers make a crowd read as people, not as traffic.
        pauseIn: this.rng.range(6, 30),
        pausedFor: 0,
      });
    }
  }

  // ------------------------------------------------------------------ rigged
  async _loadRigged() {
    const gltf = await getGltfLoader(this.ctx.renderer).loadAsync(this.characterUrl);
    const source = gltf.scene;
    const clips = gltf.animations ?? [];
    const walkClip =
      clips.find((c) => /walk/i.test(c.name)) ?? clips[0] ?? null;
    const idleClip = clips.find((c) => /idle/i.test(c.name)) ?? null;

    // Normalise to the 1.6m-eye-height world: scale so the model is `height` tall.
    const box = new THREE.Box3().setFromObject(source);
    const modelHeight = box.getSize(new THREE.Vector3()).y || 1;
    const fit = this.height / modelHeight;

    for (const walker of this.walkers) {
      const clone = SkeletonUtils.clone(source);
      clone.scale.setScalar(fit * walker.scale);
      clone.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = true; } });
      this.root.add(clone);
      walker.object = clone;

      if (walkClip) {
        const mixer = new THREE.AnimationMixer(clone);
        const action = mixer.clipAction(walkClip);
        action.timeScale = walker.speed * 0.9;
        action.play();
        walker.mixer = mixer;
        walker.walkAction = action;
        if (idleClip) walker.idleAction = mixer.clipAction(idleClip);
      }
    }
  }

  // ------------------------------------------------------------- silhouettes
  _buildSilhouettes() {
    const atlas = T.pedestrianAtlas(this.style);
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);   // feet at the origin

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uMap: { value: atlas },
          uTime: { value: 0 },
          uFrames: { value: 8 },
          uCols: { value: 4 },
          uRows: { value: 2 },
          uColor: { value: new THREE.Color(this.color) },
        },
      ]),
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute float aSpeed;
        uniform float uTime;
        uniform float uFrames;
        uniform float uCols;
        uniform float uRows;
        varying vec2 vAtlasUv;
        varying float vFogDepth;

        void main() {
          // Instance origin and scale come out of the instance matrix; the quad
          // is then expanded in view space so it always faces the camera.
          vec4 world = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sx = length(instanceMatrix[0].xyz);
          float sy = length(instanceMatrix[1].xyz);

          vec4 mv = viewMatrix * world;
          mv.x += position.x * sx;
          mv.y += position.y * sy;
          gl_Position = projectionMatrix * mv;
          vFogDepth = -mv.z;

          // Walk cycle: pick an atlas cell from time, cadence and phase.
          float frame = floor(mod(uTime * 7.0 * aSpeed + aPhase * uFrames, uFrames));
          float col = mod(frame, uCols);
          float row = floor(frame / uCols);
          vAtlasUv = vec2(
            (uv.x + col) / uCols,
            (uv.y + (uRows - 1.0 - row)) / uRows
          );
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying vec2 vAtlasUv;
        varying float vFogDepth;
        #include <fog_pars_fragment>

        void main() {
          vec4 tex = texture2D(uMap, vAtlasUv);
          // The atlas is drawn as dark ink on transparent; luminance is coverage.
          float coverage = tex.a * (1.0 - dot(tex.rgb, vec3(0.333)));
          if (coverage < 0.25) discard;
          gl_FragColor = vec4(uColor, coverage);
          #include <fog_fragment>
        }
      `,
      transparent: true,
      depthWrite: true,
      fog: true,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.InstancedMesh(geo, material, this.walkers.length);
    const phases = new Float32Array(this.walkers.length);
    const speeds = new Float32Array(this.walkers.length);
    this.walkers.forEach((w, i) => { phases[i] = w.phase; speeds[i] = w.speed; });
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    geo.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));
    mesh.frustumCulled = false;
    mesh.name = 'crowd:silhouettes';
    this.mesh = mesh;
    this.material = material;
    this.root.add(mesh);
  }

  // ------------------------------------------------------------------ update
  update(dt, ctx) {
    this._time += dt;
    if (this.material) this.material.uniforms.uTime.value = this._time;

    const scale = this.height;
    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i];

      // Loitering.
      if (w.pausedFor > 0) {
        w.pausedFor -= dt;
        w.walkAction?.setEffectiveWeight?.(0);
        w.idleAction?.play?.();
      } else {
        w.pauseIn -= dt;
        if (w.pauseIn <= 0) {
          w.pausedFor = this.rng.range(1.5, 5);
          w.pauseIn = this.rng.range(14, 45);
        }
        w.walkAction?.setEffectiveWeight?.(1);
        w.t += (w.dir * w.speed * dt) / w.length;
        w.t = (w.t % 1 + 1) % 1;
      }

      w.path.getPointAt(w.t, this._p);
      w.path.getPointAt((w.t + w.dir * 0.006 + 1) % 1, this._look);

      if (w.object) {
        w.object.position.copy(this._p);
        w.object.lookAt(this._look.x, w.object.position.y, this._look.z);
        w.mixer?.update(dt);
      } else if (this.mesh) {
        const s = scale * w.scale;
        // Silhouettes are billboards, so only position and scale matter; the
        // sign of the facing is baked into which way the sprite is flipped.
        this._s.set(w.dir > 0 ? s * 0.5 : -s * 0.5, s, s * 0.5);
        this._m.compose(this._p, IDENTITY_Q, this._s);
        this.mesh.setMatrixAt(i, this._m);
      }
    }
    if (this.mesh) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Quality tiers cut the crowd rather than the framerate (Task 4.2). */
  setCount(count) {
    const target = Math.min(count, this.walkers.length);
    if (this.mesh) this.mesh.count = target;
    else this.walkers.forEach((w, i) => { if (w.object) w.object.visible = i < target; });
  }

  dispose() {
    for (const w of this.walkers) w.mixer?.stopAllAction();
    this.walkers = [];
    disposeSubtree(this.root);
  }
}

const IDENTITY_Q = new THREE.Quaternion();
