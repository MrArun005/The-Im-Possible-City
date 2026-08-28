import * as THREE from 'three';
import { globals } from '../gfx/materials.js';
import { lerp, clamp, damp, invLerp } from '../util/math.js';
import * as T from '../gfx/textures.js';

/**
 * Day/night cycle (Task 3.4).
 *
 * Three real lights, total, forever: a hemisphere for sky/ground ambient, one
 * directional "sun or moon", and one spare that interiors borrow. Everything
 * else - lamps, neon, windows, fires - is emissive plus bloom.
 *
 * `globals.uNight` is the single number the rest of the city reads: window
 * emissives, lamp glows and steam opacity all scale off it, so dawn turns the
 * whole city off without a single per-object update.
 */

const KEYS = [
  // hour, sun/moon colour, intensity, skyTop,   skyHorizon, fog,       ambient,   night
  [0,  '#9fb4ee', 1.05, '#0a1024', '#22304e', '#26303f', '#6a7aa8', 1.00],
  [5,  '#a89ad0', 1.00, '#0d1220', '#2a2a3e', '#2c2c3a', '#6e6f9c', 0.92],
  [7,  '#ffb07a', 0.95, '#1c2c48', '#c98a5a', '#8a7a72', '#5a5a66', 0.42],
  [12, '#fff3dd', 1.55, '#3f6fae', '#c8d8e8', '#b8bcc0', '#7a8494', 0.00],
  [17, '#ffc98a', 1.15, '#2f5a92', '#d8a070', '#a08a7a', '#6a6a72', 0.16],
  [19, '#ff8a52', 1.05, '#182a48', '#c06a44', '#6a5a58', '#4e4a58', 0.60],
  [21, '#8ea4e4', 1.05, '#0c1226', '#26324e', '#2a3240', '#6c7cac', 0.95],
  [24, '#9fb4ee', 1.05, '#0a1024', '#22304e', '#26303f', '#6a7aa8', 1.00],
];

export class TimeOfDay {
  constructor(scene, { hour = 22, speed = 0 } = {}) {
    this.scene = scene;
    this.hour = hour;
    this.targetHour = hour;
    this.speed = speed;      // hours per second; 0 = frozen
    this._sky = null;

    this.hemi = new THREE.HemisphereLight(0x2a3550, 0x0a0a12, 0.5);
    this.hemi.name = 'ambient-hemi';
    scene.add(this.hemi);

    // The one directional light. It is the moon at night and the sun by day.
    this.sun = new THREE.DirectionalLight(0x8899ff, 0.4);
    this.sun.name = 'sun-moon';
    this.sun.position.set(30, 50, -20);
    scene.add(this.sun);

    this.fog = new THREE.FogExp2(0x0b0e14, 0.035);
    scene.fog = this.fog;

    this.state = {
      sunColor: new THREE.Color(),
      skyTop: new THREE.Color(),
      skyHorizon: new THREE.Color(),
      fogColor: new THREE.Color(),
      ambient: new THREE.Color(),
      sunIntensity: 0,
      night: 1,
    };

    this._applyKeys(hour, true);
  }

  /** Shadows are opt-in per tier and only ever on this one light. */
  enableShadows(size) {
    if (!size) return;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(size, size);
    const cam = this.sun.shadow.camera;
    cam.left = -34; cam.right = 34; cam.top = 34; cam.bottom = -34;
    cam.near = 1; cam.far = 140;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.03;
  }

  setDistrictGrade(grade) {
    this._grade = grade ?? {};
    this._applyKeys(this.hour, true);
  }

  /** 'N' toggles: jump to the other side of the clock, smoothly. */
  toggleNight() {
    this.targetHour = this.state.night > 0.5 ? 13 : 22;
    return this.targetHour;
  }

  setHour(hour, instant = false) {
    this.targetHour = ((hour % 24) + 24) % 24;
    if (instant) { this.hour = this.targetHour; this._applyKeys(this.hour, true); }
  }

  update(dt) {
    if (this.speed) {
      this.targetHour = (this.targetHour + this.speed * dt) % 24;
      this.hour = this.targetHour;
    } else if (Math.abs(this.hour - this.targetHour) > 0.01) {
      // Take the short way round the clock.
      let delta = this.targetHour - this.hour;
      if (delta > 12) delta -= 24;
      if (delta < -12) delta += 24;
      this.hour = ((this.hour + delta * Math.min(1, dt * 0.9)) % 24 + 24) % 24;
    }
    this._applyKeys(this.hour, false, dt);
  }

  _applyKeys(hour, instant, dt = 0.016) {
    let a = KEYS[0];
    let b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (hour >= KEYS[i][0] && hour <= KEYS[i + 1][0]) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const t = invLerp(a[0], b[0], hour);
    const s = this.state;
    const grade = this._grade ?? {};

    const mix = (target, ai, bi, tintKey) => {
      const c = new THREE.Color(a[ai]).lerp(new THREE.Color(b[ai]), t);
      if (grade[tintKey]) c.lerp(new THREE.Color(grade[tintKey]), grade.tintStrength ?? 0.5);
      if (instant) target.copy(c);
      else target.lerp(c, 1 - Math.exp(-3.5 * dt));
    };

    mix(s.sunColor, 1, 1, 'sunTint');
    mix(s.skyTop, 3, 3, 'skyTint');
    mix(s.skyHorizon, 4, 4, 'horizonTint');
    mix(s.fogColor, 5, 5, 'fog');
    mix(s.ambient, 6, 6, 'ambientColor');

    const targetIntensity = lerp(a[2], b[2], t) * (grade.sunScale ?? 1);
    const targetNight = lerp(a[7], b[7], t);
    s.sunIntensity = instant ? targetIntensity : damp(s.sunIntensity, targetIntensity, 3.5, dt);
    s.night = instant ? targetNight : damp(s.night, targetNight, 3.5, dt);

    // Apply.
    this.sun.color.copy(s.sunColor);
    this.sun.intensity = s.sunIntensity;
    /**
     * Elevation follows the clock; AZIMUTH is art-directed.
     *
     * The hour alone gives a physically honest sky and a badly lit city: at
     * 21:30 the moon lands behind the north row of facades, so every door on
     * the south side of the street renders as an unlit slab. A district may
     * therefore pin `grade.lightAzimuth` to rake the light across the facades
     * that matter. Elevation still comes from the hour, so dawn and dusk read
     * correctly - it is the compass bearing that is a lighting decision, not a
     * simulation one.
     */
    const angle = ((hour - 6) / 24) * Math.PI * 2;
    const elevation = 14 + Math.abs(Math.sin(angle)) * 56;
    const azimuth = grade.lightAzimuth ?? angle;
    this.sun.position.set(Math.cos(azimuth) * 60, elevation, Math.sin(azimuth) * 55);
    // The hemisphere light is the whole of the night's fill. It takes the
    // ambient colour directly - deriving it from the (near-black) night sky top
    // is how you end up with a city you cannot see.
    this.hemi.color.copy(s.ambient);
    this.hemi.groundColor.copy(s.fogColor).multiplyScalar(0.55);
    this.hemi.intensity = lerp(3.1, 0.9, 1 - s.night) * (grade.ambientScale ?? 1);

    this.fog.color.copy(s.fogColor);
    this.fog.density = lerp(
      grade.fogDay ?? 0.014,
      grade.fogNight ?? 0.026,
      clamp(s.night, 0, 1)
    );

    globals.uNight.value = clamp(s.night, 0.02, 1);
    this._skyDirty = true;
  }

  /** The sky dome shares its gradient texture with the grade, regenerated lazily. */
  skyStops() {
    const s = this.state;
    return [
      [0, `#${s.skyTop.getHexString()}`],
      [0.55, `#${s.skyHorizon.clone().lerp(s.skyTop, 0.45).getHexString()}`],
      [1, `#${s.fogColor.getHexString()}`],
    ];
  }

  dispose() {
    this.hemi.dispose?.();
    this.sun.dispose?.();
    this.scene.remove(this.hemi, this.sun);
  }
}

/** A sky dome that reads its gradient from TimeOfDay, plus stars at night. */
export class SkyDome {
  /**
   * The dome radius MUST stay inside the camera's far plane (200m) and the mesh
   * has to ride with the camera - a world-fixed dome gets sliced by the far
   * plane the moment you walk away from the origin, and the slice renders as a
   * black hole in the sky.
   */
  constructor(timeOfDay, { stars = true, radius = 150 } = {}) {
    this.timeOfDay = timeOfDay;
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uBottom: { value: new THREE.Color() },
        uStars: { value: stars ? T.stars() : null },
        uStarStrength: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        varying vec2 vUvSky;
        void main() {
          vDir = normalize(position);
          vUvSky = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uBottom;
        uniform sampler2D uStars;
        uniform float uStarStrength;
        varying vec3 vDir;
        varying vec2 vUvSky;

        void main() {
          float h = vDir.y;
          vec3 col = h > 0.0
            ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55))
            : mix(uHorizon, uBottom, clamp(-h * 3.0, 0.0, 1.0));
          if (uStarStrength > 0.001) {
            col += texture2D(uStars, vUvSky).rgb * uStarStrength * clamp(h * 2.0, 0.0, 1.0);
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const geo = new THREE.SphereGeometry(radius, 24, 16);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this._envAge = 0;
    this._envSnapshot = null;
    this._envIntensity = 1;
  }

  update(camera, dt = 0) {
    if (camera) this.mesh.position.copy(camera.position);
    const s = this.timeOfDay.state;
    const u = this.material.uniforms;
    u.uTop.value.copy(s.skyTop);
    u.uHorizon.value.copy(s.skyHorizon);
    u.uBottom.value.copy(s.fogColor);
    u.uStarStrength.value = Math.max(0, s.night - 0.45) * 1.4;

    this._envAge += dt;
    if (this._envAge > 1.5 && this._envDirty()) this.refreshEnvironment();
  }

  /**
   * Image-based ambient from the sky itself.
   *
   * ONE directional light can only ever light one side of a street; the facades
   * facing away from it fall to whatever the hemisphere fill gives them, which
   * is not much, and half the city renders as black slabs. The budget allows no
   * more lights (§3.4: three, total), so the fill comes from an environment map
   * instead: the sky dome is prefiltered into a small PMREM cube and assigned to
   * `scene.environment`, and every standard material in the city picks up
   * directionally-correct ambient for free. No light slots, one small texture.
   *
   * It is regenerated on a 1.5s throttle, and only when the sky has actually
   * moved, so a day/night sweep costs a handful of prefilter passes rather than
   * one per frame.
   */
  refreshEnvironment() {
    const { renderer, scene } = this._envCtx ?? {};
    if (!renderer || !scene) return;

    this._pmrem = this._pmrem ?? new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    // A copy of the dome, small and centred: the prefilter only needs direction.
    const probe = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), this.material);
    skyScene.add(probe);

    const previous = this._envTarget;
    this._envTarget = this._pmrem.fromScene(skyScene, 0, 0.5, 40);
    scene.environment = this._envTarget.texture;
    scene.environmentIntensity = this._envIntensity;

    probe.geometry.dispose();
    previous?.dispose();
    this._envAge = 0;
    this._envSnapshot = this._skySignature();
  }

  /** Call once, after the dome is in the scene. */
  attachEnvironment(renderer, scene, intensity = 1) {
    this._envCtx = { renderer, scene };
    this._envIntensity = intensity;
    this._envAge = 0;
    this.refreshEnvironment();
  }

  _skySignature() {
    const s = this.timeOfDay.state;
    return s.skyTop.getHex() * 3 + s.skyHorizon.getHex() * 5 + s.fogColor.getHex() * 7;
  }

  _envDirty() {
    return this._skySignature() !== this._envSnapshot;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
    this._envTarget?.dispose();
    this._pmrem?.dispose();
    if (this._envCtx?.scene) this._envCtx.scene.environment = null;
  }
}
